// Validated on-device (spike S3). Not part of the Node-side typecheck; compiled
// by Metro in apps/mobile where react-native-udp is installed.
import dgram from 'react-native-udp';
import { Buffer } from 'buffer';
import type { UdpFamily, UdpSocket, UdpSocketFactory, UdpMessage } from '../types.js';

class RnUdpSocket implements UdpSocket {
  private sock = dgram.createSocket({ type: 'udp4', reusePort: true });

  constructor(_family: UdpFamily) {
    // react-native-udp currently exposes udp4 sockets; udp6 tracked for later.
  }

  bind(port?: number, address?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.sock.once('error', reject);
        this.sock.bind(port ?? 0, address, () => resolve());
      } catch (e) {
        reject(e as Error);
      }
    });
  }

  send(data: Uint8Array, port: number, address: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const buf = Buffer.from(data);
      this.sock.send(buf, 0, buf.length, port, address, (err: Error | null) =>
        err ? reject(err) : resolve(),
      );
    });
  }

  onMessage(listener: (msg: UdpMessage) => void): () => void {
    const handler = (data: Buffer, rinfo: { address: string; port: number }) =>
      listener({ data: new Uint8Array(data), address: rinfo.address, port: rinfo.port });
    this.sock.on('message', handler);
    return () => this.sock.removeListener('message', handler);
  }

  onError(listener: (err: Error) => void): () => void {
    this.sock.on('error', listener);
    return () => this.sock.removeListener('error', listener);
  }

  address(): { address: string; port: number } | null {
    try {
      return this.sock.address();
    } catch {
      return null;
    }
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.sock.close(() => resolve());
    });
  }
}

export const rnUdpFactory: UdpSocketFactory = {
  create: (family) => new RnUdpSocket(family),
};
