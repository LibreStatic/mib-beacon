import dgram from 'node:dgram';
import type { UdpFamily, UdpSocket, UdpSocketFactory, UdpMessage } from '../types.js';

class NodeUdpSocket implements UdpSocket {
  private sock: dgram.Socket;

  constructor(family: UdpFamily) {
    this.sock = dgram.createSocket({ type: family, reuseAddr: true });
  }

  bind(port?: number, address?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const onErr = (e: Error) => reject(e);
      this.sock.once('error', onErr);
      this.sock.bind(port, address, () => {
        this.sock.off('error', onErr);
        resolve();
      });
    });
  }

  send(data: Uint8Array, port: number, address: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.sock.send(data, port, address, (err) => (err ? reject(err) : resolve()));
    });
  }

  onMessage(listener: (msg: UdpMessage) => void): () => void {
    const handler = (data: Buffer, rinfo: dgram.RemoteInfo) => {
      listener({ data: new Uint8Array(data), address: rinfo.address, port: rinfo.port });
    };
    this.sock.on('message', handler);
    return () => this.sock.off('message', handler);
  }

  onError(listener: (err: Error) => void): () => void {
    this.sock.on('error', listener);
    return () => this.sock.off('error', listener);
  }

  address(): { address: string; port: number } | null {
    try {
      const a = this.sock.address();
      return { address: a.address, port: a.port };
    } catch {
      return null;
    }
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.sock.close(() => resolve()));
  }
}

export const nodeUdpFactory: UdpSocketFactory = {
  create: (family) => new NodeUdpSocket(family),
};
