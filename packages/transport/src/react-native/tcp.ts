// Validated on-device (spike S3). Compiled by Metro in apps/mobile. Typed via a
// local interface matching react-native-tcp-socket's documented runtime API.
import TcpSockets from 'react-native-tcp-socket';
import { Buffer } from 'buffer';
import type { TcpSocket, TcpSocketFactory } from '../types.js';

type Listener = (...args: unknown[]) => void;
interface RnTcp {
  write(data: Uint8Array, encoding: undefined, cb: (err?: Error) => void): void;
  on(event: string, listener: Listener): void;
  once(event: string, listener: Listener): void;
  removeListener(event: string, listener: Listener): void;
  end(): void;
}

class RnTcpSocket implements TcpSocket {
  private sock: RnTcp | null = null;

  connect(port: number, host: string, opts?: { tls?: boolean }): Promise<void> {
    return new Promise((resolve, reject) => {
      const connector = opts?.tls ? TcpSockets.connectTLS : TcpSockets.createConnection;
      const s = connector({ port, host } as never, () => resolve()) as unknown as RnTcp;
      s.once('error', (e) => reject(e as Error));
      this.sock = s;
    });
  }

  write(data: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.sock) return reject(new Error('socket not connected'));
      this.sock.write(Buffer.from(data), undefined, (err) => (err ? reject(err) : resolve()));
    });
  }

  onData(listener: (data: Uint8Array) => void): () => void {
    const handler: Listener = (...args) => {
      const d = args[0] as Uint8Array | string;
      listener(new Uint8Array(typeof d === 'string' ? Buffer.from(d) : d));
    };
    this.sock?.on('data', handler);
    return () => this.sock?.removeListener('data', handler);
  }

  onError(listener: (err: Error) => void): () => void {
    const handler: Listener = (...args) => listener(args[0] as Error);
    this.sock?.on('error', handler);
    return () => this.sock?.removeListener('error', handler);
  }

  onClose(listener: () => void): () => void {
    const handler: Listener = () => listener();
    this.sock?.on('close', handler);
    return () => this.sock?.removeListener('close', handler);
  }

  end(): Promise<void> {
    return new Promise((resolve) => {
      this.sock?.end();
      resolve();
    });
  }
}

export const rnTcpFactory: TcpSocketFactory = {
  create: () => new RnTcpSocket(),
};
