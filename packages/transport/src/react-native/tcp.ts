// Validated on-device (spike S3). Compiled by Metro in apps/mobile.
import TcpSockets from 'react-native-tcp-socket';
import { Buffer } from 'buffer';
import type { TcpSocket, TcpSocketFactory } from '../types.js';

class RnTcpSocket implements TcpSocket {
  private sock: ReturnType<typeof TcpSockets.createConnection> | null = null;

  connect(port: number, host: string, opts?: { tls?: boolean }): Promise<void> {
    return new Promise((resolve, reject) => {
      const connector = opts?.tls ? TcpSockets.connectTLS : TcpSockets.createConnection;
      this.sock = connector({ port, host }, () => resolve());
      this.sock.once('error', reject);
    });
  }

  write(data: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.sock) return reject(new Error('socket not connected'));
      this.sock.write(Buffer.from(data), undefined, (err?: Error) =>
        err ? reject(err) : resolve(),
      );
    });
  }

  onData(listener: (data: Uint8Array) => void): () => void {
    const handler = (d: Buffer | string) =>
      listener(new Uint8Array(typeof d === 'string' ? Buffer.from(d) : d));
    this.sock?.on('data', handler);
    return () => void this.sock?.removeListener('data', handler);
  }

  onError(listener: (err: Error) => void): () => void {
    this.sock?.on('error', listener);
    return () => void this.sock?.removeListener('error', listener);
  }

  onClose(listener: () => void): () => void {
    this.sock?.on('close', listener);
    return () => void this.sock?.removeListener('close', listener);
  }

  end(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.sock) return resolve();
      this.sock.end();
      resolve();
    });
  }
}

export const rnTcpFactory: TcpSocketFactory = {
  create: () => new RnTcpSocket(),
};
