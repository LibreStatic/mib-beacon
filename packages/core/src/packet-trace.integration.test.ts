import { createSocket } from 'node:dgram';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createNodeTransport } from '@mibbeacon/transport/node';
import { createEngine } from './engine';
import type { PacketTraceEvent } from './packet-trace';

async function freeUdpPort(): Promise<number> {
  const socket = createSocket('udp4');
  await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  return port;
}

describe('live packet tracing', () => {
  it('emits exact outgoing, accepted incoming, and invalid incoming datagrams', async () => {
    const port = await freeUdpPort();
    const engine = createEngine(createNodeTransport({ dataDir: tmpdir() }), { dbPath: ':memory:' });
    const packets: PacketTraceEvent[] = [];
    const off = engine.events.subscribe('packets', (event) => {
      if (event.kind !== 'packet') return;
      const packet = event.payload as PacketTraceEvent;
      const index = packets.findIndex(({ id }) => id === packet.id);
      if (index >= 0) packets[index] = packet;
      else packets.push(packet);
    });
    await engine.traps.startReceiver({ port, transport: 'udp4', disableAuthorization: true });

    try {
      await engine.traps.send({
        target: { host: '127.0.0.1', port, version: 'v2c', community: 'public' },
        kind: 'trap',
        trapOid: '1.3.6.1.6.3.1.1.5.1',
        varbinds: [],
      });
      await engine.traps.send({
        target: { host: '127.0.0.1', port, version: 'v2c', community: 'public' },
        kind: 'inform',
        trapOid: '1.3.6.1.6.3.1.1.5.2',
        varbinds: [],
      });
      const raw = createSocket('udp4');
      await new Promise<void>((resolve, reject) =>
        raw.send(Uint8Array.from([0xde, 0xad, 0xbe, 0xef]), port, '127.0.0.1', (error) => {
          raw.close();
          if (error) reject(error);
          else resolve();
        }),
      );
      for (let attempt = 0; attempt < 40 && !packets.some(({ status }) => status === 'invalid'); attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      expect(packets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ direction: 'tx', operation: 'trap', status: 'valid' }),
          expect.objectContaining({ direction: 'rx', operation: 'trap', status: 'valid' }),
          expect.objectContaining({ direction: 'tx', operation: 'response', status: 'valid' }),
          expect.objectContaining({ direction: 'rx', status: 'invalid', rawHex: 'de ad be ef' }),
        ]),
      );
      expect(packets.find(({ direction, status }) => direction === 'tx' && status === 'valid')?.rawHex)
        .toMatch(/^30 /);
      expect(packets.filter(({ direction, operation }) => direction === 'tx' && operation === 'trap')).toHaveLength(1);
      expect(packets.some(({ status }) => status === 'pending')).toBe(false);
    } finally {
      off();
      await engine.traps.stopReceiver();
    }
  });
});
