import { describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;
  class Socket {
    readonly listeners = new Map<string, Set<Listener>>();
    write(_data: Uint8Array, _encoding: undefined, callback: (error?: Error) => void): void {
      callback();
    }
    on(event: string, listener: Listener): void {
      const listeners = this.listeners.get(event) ?? new Set<Listener>();
      listeners.add(listener);
      this.listeners.set(event, listeners);
    }
    once(event: string, listener: Listener): void { this.on(event, listener); }
    removeListener(event: string, listener: Listener): void { this.listeners.get(event)?.delete(listener); }
    end(): void {}
    emit(event: string, ...args: unknown[]): void {
      for (const listener of this.listeners.get(event) ?? []) listener(...args);
    }
  }
  class TlsSocket extends Socket {
    constructor(readonly plainSocket: Socket, readonly options: Record<string, unknown>) { super(); }
  }
  const plainSockets: Socket[] = [];
  const tlsSockets: TlsSocket[] = [];
  return { Socket, TlsSocket, plainSockets, tlsSockets };
});

vi.mock('react-native-tcp-socket', () => ({
  default: {
    createConnection: (_options: unknown, callback: () => void) => {
      const socket = new fakes.Socket();
      fakes.plainSockets.push(socket);
      queueMicrotask(callback);
      return socket;
    },
    connectTLS: vi.fn(),
    TLSSocket: class extends fakes.TlsSocket {
      constructor(socket: InstanceType<typeof fakes.Socket>, options: Record<string, unknown>) {
        super(socket, options);
        fakes.tlsSockets.push(this);
      }
    },
  },
}));

describe('rnTcpFactory', () => {
  it('rejects TLS upgrades because the React Native backend cannot verify certificates and hostnames', async () => {
    const { rnTcpFactory } = await import('./tcp');
    const socket = rnTcpFactory.create();
    await socket.connect(21, 'ftp.example.test');

    await expect(
      socket.startTls({ serverName: 'ftp.example.test', rejectUnauthorized: true }),
    ).rejects.toThrow(/TLS.*not supported.*certificate.*hostname/i);
    expect(fakes.tlsSockets).toHaveLength(0);
  });
});
