import net from 'node:net';
import tls from 'node:tls';
import type { TcpSocket, TcpSocketFactory, TcpTlsOptions } from '../types';

class NodeTcpSocket implements TcpSocket {
  private sock: net.Socket | null = null;
  private host: string | undefined;
  private readonly dataListeners = new Set<(data: Uint8Array) => void>();
  private readonly errorListeners = new Set<(error: Error) => void>();
  private readonly closeListeners = new Set<() => void>();

  private readonly handleData = (data: Buffer): void => {
    const bytes = new Uint8Array(data);
    for (const listener of this.dataListeners) listener(bytes);
  };
  private readonly handleError = (error: Error): void => {
    for (const listener of this.errorListeners) listener(error);
  };
  private readonly handleClose = (): void => {
    for (const listener of this.closeListeners) listener();
  };

  connect(port: number, host: string, opts?: { tls?: boolean }): Promise<void> {
    this.host = host;
    return new Promise((resolve, reject) => {
      const onErr = (e: Error) => reject(e);
      if (opts?.tls) {
        const s = tls.connect({ port, host, rejectUnauthorized: false }, () => {
          s.off('error', onErr);
          resolve();
        });
        s.once('error', onErr);
        this.setSocket(s);
      } else {
        const s = net.connect({ port, host }, () => {
          s.off('error', onErr);
          resolve();
        });
        s.once('error', onErr);
        this.setSocket(s);
      }
    });
  }

  startTls(options: TcpTlsOptions = {}): Promise<void> {
    if (!this.sock) return Promise.reject(new Error('socket not connected'));
    const plainSocket = this.sock;
    this.unbindSocket(plainSocket);
    return new Promise((resolve, reject) => {
      const secureSocket = tls.connect({
        socket: plainSocket,
        servername: options.serverName ?? this.host,
        rejectUnauthorized: options.rejectUnauthorized ?? true,
      });
      const onError = (error: Error): void => reject(error);
      secureSocket.once('error', onError);
      secureSocket.once('secureConnect', () => {
        secureSocket.off('error', onError);
        resolve();
      });
      this.setSocket(secureSocket);
    });
  }

  write(data: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.sock) return reject(new Error('socket not connected'));
      this.sock.write(data, (err) => (err ? reject(err) : resolve()));
    });
  }

  onData(listener: (data: Uint8Array) => void): () => void {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  onError(listener: (err: Error) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  end(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.sock) return resolve();
      this.sock.end(() => resolve());
    });
  }

  private setSocket(socket: net.Socket): void {
    this.sock = socket;
    socket.on('data', this.handleData);
    socket.on('error', this.handleError);
    socket.on('close', this.handleClose);
  }

  private unbindSocket(socket: net.Socket): void {
    socket.off('data', this.handleData);
    socket.off('error', this.handleError);
    socket.off('close', this.handleClose);
  }
}

export const nodeTcpFactory: TcpSocketFactory = {
  create: () => new NodeTcpSocket(),
};
