// Validated on-device (spike S3). Compiled by Metro in apps/mobile where
// react-native-udp is installed. Typed via a local interface matching the
// library's documented EventEmitter-based runtime API.
import dgram from 'react-native-udp';
import { Buffer } from 'buffer';
import type { UdpFamily, UdpSocket, UdpSocketFactory, UdpMessage } from '../types';

type Listener = (...args: unknown[]) => void;
interface RnDatagram {
  bind(port: number, address: string | undefined, cb: () => void): void;
  send(
    msg: Buffer,
    offset: number,
    length: number,
    port: number,
    address: string,
    cb: (err?: Error) => void,
  ): void;
  on(event: string, listener: Listener): void;
  once(event: string, listener: Listener): void;
  removeListener(event: string, listener: Listener): void;
  address(): { address: string; port: number };
  close(cb?: () => void): void;
}

class RnUdpSocket implements UdpSocket {
  private sock: RnDatagram;

  constructor(_family: UdpFamily) {
    // react-native-udp currently exposes udp4 sockets; udp6 tracked for later.
    this.sock = dgram.createSocket({ type: 'udp4', reusePort: true }) as unknown as RnDatagram;
  }

  bind(port?: number, address?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.sock.once('error', (e) => reject(e as Error));
      this.sock.bind(port ?? 0, address, () => resolve());
    });
  }

  send(data: Uint8Array, port: number, address: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const buf = Buffer.from(data);
      this.sock.send(buf, 0, buf.length, port, address, (err) => (err ? reject(err) : resolve()));
    });
  }

  onMessage(listener: (msg: UdpMessage) => void): () => void {
    const handler: Listener = (...args) => {
      const data = args[0] as Uint8Array;
      const rinfo = args[1] as { address: string; port: number };
      listener({ data: new Uint8Array(data), address: rinfo.address, port: rinfo.port });
    };
    this.sock.on('message', handler);
    return () => this.sock.removeListener('message', handler);
  }

  onError(listener: (err: Error) => void): () => void {
    const handler: Listener = (...args) => listener(args[0] as Error);
    this.sock.on('error', handler);
    return () => this.sock.removeListener('error', handler);
  }

  address(): { address: string; port: number } | null {
    try {
      return this.sock.address();
    } catch {
      return null;
    }
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.sock.close(() => resolve()));
  }
}

export const rnUdpFactory: UdpSocketFactory = {
  create: (family) => new RnUdpSocket(family),
};
