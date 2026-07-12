// Validated on-device (spike S3). Compiled by Metro in apps/mobile. Typed via a
// local interface matching react-native-tcp-socket's documented runtime API.
import TcpSockets from 'react-native-tcp-socket';
import { Buffer } from 'buffer';
import type { TcpSocket, TcpSocketFactory, TcpTlsOptions } from '../types';

type Listener = (...args: unknown[]) => void;
interface RnTcp {
  write(data: Uint8Array, encoding: undefined, cb: (err?: Error) => void): void;
  on(event: string, listener: Listener): void;
  once(event: string, listener: Listener): void;
  removeListener(event: string, listener: Listener): void;
  end(): void;
}

interface RnTcpModule {
  createConnection(options: { port: number; host: string }, callback: () => void): RnTcp;
  connectTLS(options: { port: number; host: string }, callback: () => void): RnTcp;
}

const tcpSockets = TcpSockets as unknown as RnTcpModule;

class RnTcpSocket implements TcpSocket {
  private sock: RnTcp | null = null;
  private readonly dataListeners = new Set<(data: Uint8Array) => void>();
  private readonly errorListeners = new Set<(error: Error) => void>();
  private readonly closeListeners = new Set<() => void>();
  private readonly handleData: Listener = (...args) => {
    const data = args[0] as Uint8Array | string;
    const bytes = new Uint8Array(typeof data === 'string' ? Buffer.from(data) : data);
    for (const listener of this.dataListeners) listener(bytes);
  };
  private readonly handleError: Listener = (...args) => {
    for (const listener of this.errorListeners) listener(args[0] as Error);
  };
  private readonly handleClose: Listener = () => {
    for (const listener of this.closeListeners) listener();
  };

  connect(port: number, host: string, opts?: { tls?: boolean }): Promise<void> {
    return new Promise((resolve, reject) => {
      const connector = opts?.tls ? tcpSockets.connectTLS : tcpSockets.createConnection;
      const onError: Listener = (...args) => reject(args[0] as Error);
      const socket = connector({ port, host }, () => {
        socket.removeListener('error', onError);
        resolve();
      });
      socket.once('error', onError);
      this.setSocket(socket);
    });
  }

  startTls(_options: TcpTlsOptions = {}): Promise<void> {
    return Promise.reject(
      new Error(
        'TLS upgrade is not supported on React Native because certificate and hostname verification cannot be guaranteed',
      ),
    );
  }

  write(data: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.sock) return reject(new Error('socket not connected'));
      this.sock.write(Buffer.from(data), undefined, (err) => (err ? reject(err) : resolve()));
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
      this.sock?.end();
      resolve();
    });
  }

  private setSocket(socket: RnTcp): void {
    this.sock = socket;
    socket.on('data', this.handleData);
    socket.on('error', this.handleError);
    socket.on('close', this.handleClose);
  }

  private unbindSocket(socket: RnTcp): void {
    socket.removeListener('data', this.handleData);
    socket.removeListener('error', this.handleError);
    socket.removeListener('close', this.handleClose);
  }
}

export const rnTcpFactory: TcpSocketFactory = {
  create: () => new RnTcpSocket(),
};
