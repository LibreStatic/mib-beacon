import { createSocket } from 'node:dgram';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createNodeTransport } from '@omc/transport/node';
import { createEngine } from './engine';

async function freeUdpPort(): Promise<number> {
  const socket = createSocket('udp4');
  await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve));
  const address = socket.address();
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  return address.port;
}

describe('notification sender', () => {
  it('publishes capture-clear events for every connected view', async () => {
    const engine = createEngine(createNodeTransport({ dataDir: tmpdir() }), { dbPath: ':memory:' });
    const events: Array<{ kind: string; payload: unknown }> = [];
    const unsubscribe = engine.events.subscribe('traps', (event) => events.push(event));

    await engine.traps.clear();
    unsubscribe();

    expect(events).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'cleared', payload: { count: 0 } })]),
    );
  });

  it('round-trips a v2c trap through the engine receiver on a custom port', async () => {
    const port = await freeUdpPort();
    const engine = createEngine(createNodeTransport({ dataDir: tmpdir() }), { dbPath: ':memory:' });
    await engine.traps.startReceiver({ port, disableAuthorization: true, communities: ['public'] });
    await new Promise((resolve) => setTimeout(resolve, 30));

    try {
      await engine.traps.send({
        target: { host: '127.0.0.1', port, version: 'v2c', community: 'public' },
        kind: 'trap',
        trapOid: '1.3.6.1.6.3.1.1.5.1',
        varbinds: [],
      });

      let records = await engine.traps.list();
      for (let attempt = 0; attempt < 20 && records.length === 0; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        records = await engine.traps.list();
      }
      expect(records[0]).toMatchObject({ trapOid: '1.3.6.1.6.3.1.1.5.1', trapName: 'coldStart' });

      await engine.traps.send({
        target: { host: '127.0.0.1', port, version: 'v1', community: 'public' },
        kind: 'trap',
        trapOid: '1.3.6.1.6.3.1.1.5.1',
        varbinds: [],
      });
      for (let attempt = 0; attempt < 20 && records.length < 2; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        records = await engine.traps.list();
      }
      expect(records[0]).toMatchObject({ trapOid: '1.3.6.1.6.3.1.1.5.1', trapName: 'coldStart' });
    } finally {
      await engine.traps.stopReceiver();
    }
  });
});
