import net from 'node:net';
import tls from 'node:tls';
import type { TcpSocket, TcpSocketFactory } from '../types';

class NodeTcpSocket implements TcpSocket {
  private sock: net.Socket | null = null;

  connect(port: number, host: string, opts?: { tls?: boolean }): Promise<void> {
    return new Promise((resolve, reject) => {
      const onErr = (e: Error) => reject(e);
      if (opts?.tls) {
        const s = tls.connect({ port, host, rejectUnauthorized: false }, () => {
          s.off('error', onErr);
          resolve();
        });
        s.once('error', onErr);
        this.sock = s;
      } else {
        const s = net.connect({ port, host }, () => {
          s.off('error', onErr);
          resolve();
        });
        s.once('error', onErr);
        this.sock = s;
      }
    });
  }

  write(data: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.sock) return reject(new Error('socket not connected'));
      this.sock.write(data, (err) => (err ? reject(err) : resolve()));
    });
  }

  onData(listener: (data: Uint8Array) => void): () => void {
    const handler = (d: Buffer) => listener(new Uint8Array(d));
    this.sock?.on('data', handler);
    return () => this.sock?.off('data', handler);
  }

  onError(listener: (err: Error) => void): () => void {
    this.sock?.on('error', listener);
    return () => this.sock?.off('error', listener);
  }

  onClose(listener: () => void): () => void {
    this.sock?.on('close', listener);
    return () => this.sock?.off('close', listener);
  }

  end(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.sock) return resolve();
      this.sock.end(() => resolve());
    });
  }
}

export const nodeTcpFactory: TcpSocketFactory = {
  create: () => new NodeTcpSocket(),
};
