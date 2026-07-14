import { createSocket } from 'node:dgram';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNodeTransport } from '@mibbeacon/transport/node';
import { createEngine } from './engine';
import snmp from 'net-snmp';

async function freeUdpPort(): Promise<number> {
  const socket = createSocket('udp4');
  await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve));
  const address = socket.address();
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  return address.port;
}

describe('notification sender', () => {
  it('does not report a receiver as running until its UDP port is bound', async () => {
    const occupied = createSocket('udp4');
    await new Promise<void>((resolve) => occupied.bind(0, '127.0.0.1', resolve));
    const port = occupied.address().port;
    const engine = createEngine(createNodeTransport({ dataDir: tmpdir() }), { dbPath: ':memory:' });

    try {
      await expect(
        engine.traps.startReceiver({ port, disableAuthorization: true }),
      ).rejects.toMatchObject({ code: 'SOCKET_ERROR' });
      await expect(engine.traps.status()).resolves.toMatchObject({ running: false });
    } finally {
      await engine.traps.stopReceiver();
      await new Promise<void>((resolve) => occupied.close(() => resolve()));
    }
  });

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
    await engine.traps.rules.create({
      name: 'Cold start alert',
      enabled: true,
      priority: 10,
      condition: { trapOidGlob: '1.3.6.1.6.3.1.1.5.1' },
      actions: { severity: 'critical', color: '#ef4444', notify: true },
    });
    const ruleEvents: { kind: string }[] = [];
    const offRules = engine.events.subscribe('traps', (event) => ruleEvents.push(event));
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
      expect(records[0]).toMatchObject({
        trapOid: '1.3.6.1.6.3.1.1.5.1',
        trapName: 'coldStart',
        version: snmp.Version2c,
        securityName: 'public',
        rawPduHex: expect.any(String),
        severity: 'critical',
        color: '#ef4444',
      });
      expect(ruleEvents).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'rule-notification' })]));
      await expect(engine.traps.status()).resolves.toMatchObject({
        transports: expect.arrayContaining(['udp4']),
      });

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

      await engine.traps.send({
        target: { host: '127.0.0.1', port, version: 'v1', community: 'public' },
        kind: 'trap',
        trapOid: '1.3.6.1.4.1.424242.0.42',
        v1Enterprise: '1.3.6.1.4.1.424242',
        v1Generic: 6,
        v1Specific: 42,
        agentAddress: '192.0.2.10',
        varbinds: [],
      });
      for (let attempt = 0; attempt < 20 && records.length < 3; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        records = await engine.traps.list();
      }
      expect(records[0]).toMatchObject({
        trapOid: '1.3.6.1.4.1.424242.0.42',
        version: snmp.Version1,
      });
    } finally {
      offRules();
      await engine.traps.stopReceiver();
    }
  });

  it('acks informs and persists malformed or unknown-user packets without stopping capture', async () => {
    const port = await freeUdpPort();
    const engine = createEngine(createNodeTransport({ dataDir: tmpdir() }), { dbPath: ':memory:' });
    await engine.traps.v3Users.upsert({
      name: 'known-user',
      level: 'noAuthNoPriv',
    });
    await engine.traps.startReceiver({
      port,
      transport: 'udp4',
      disableAuthorization: false,
      communities: ['public'],
    });

    try {
      await expect(
        engine.traps.send({
          target: { host: '127.0.0.1', port, version: 'v2c', community: 'public' },
          kind: 'inform',
          trapOid: '1.3.6.1.6.3.1.1.5.2',
          varbinds: [],
        }),
      ).resolves.toMatchObject({ acknowledged: true });
      await engine.traps.send({
        target: {
          host: '127.0.0.1',
          port,
          version: 'v3',
          v3: { user: 'known-user', level: 'noAuthNoPriv' },
        },
        kind: 'trap',
        trapOid: '1.3.6.1.6.3.1.1.5.3',
        varbinds: [],
      });
      await engine.traps.send({
        target: {
          host: '127.0.0.1',
          port,
          version: 'v3',
          v3: { user: 'unknown-user', level: 'noAuthNoPriv' },
        },
        kind: 'trap',
        trapOid: '1.3.6.1.6.3.1.1.5.4',
        varbinds: [],
      });
      const raw = createSocket('udp4');
      await new Promise<void>((resolve, reject) =>
        raw.send(Buffer.from([0xde, 0xad, 0xbe, 0xef]), port, '127.0.0.1', (error) => {
          raw.close();
          if (error) reject(error);
          else resolve();
        }),
      );

      let records = await engine.traps.list();
      for (
        let attempt = 0;
        attempt < 40 &&
        (!records.some(({ trapOid }) => trapOid === '1.3.6.1.6.3.1.1.5.3') ||
          records.filter(({ parseError }) => parseError).length < 2);
        attempt++
      ) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        records = await engine.traps.list();
      }
      expect(records).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ trapOid: '1.3.6.1.6.3.1.1.5.2', version: snmp.Version2c }),
          expect.objectContaining({ trapOid: '1.3.6.1.6.3.1.1.5.3', version: snmp.Version3 }),
          expect.objectContaining({ parseError: expect.any(String), rawPduHex: expect.any(String) }),
        ]),
      );
      expect(records.filter(({ parseError }) => parseError).length).toBeGreaterThanOrEqual(2);
      await expect(engine.traps.status()).resolves.toMatchObject({ running: true });
      expect((await engine.traps.status()).drops).toBeGreaterThanOrEqual(2);
    } finally {
      await engine.traps.stopReceiver();
    }
  });

  it('persists MIB conformance diagnostics across an engine restart', async () => {
    const port = await freeUdpPort();
    const directory = await mkdtemp(join(tmpdir(), 'mibbeacon-trap-persistence-'));
    const dbPath = join(directory, 'mibbeacon.db');
    const transport = createNodeTransport({ dataDir: directory });
    const engine = createEngine(transport, { dbPath });
    await engine.mibs.importTexts([
      {
        name: 'TRAP-FIXTURE-MIB.mib',
        content: `TRAP-FIXTURE-MIB DEFINITIONS ::= BEGIN
IMPORTS enterprises, OBJECT-TYPE, NOTIFICATION-TYPE, Integer32 FROM SNMPv2-SMI;
fixtureRoot OBJECT IDENTIFIER ::= { enterprises 424242 }
fixtureValue OBJECT-TYPE
  SYNTAX Integer32
  MAX-ACCESS read-only
  STATUS current
  DESCRIPTION "Expected fixture value."
  ::= { fixtureRoot 1 }
fixtureMissing OBJECT-TYPE
  SYNTAX Integer32
  MAX-ACCESS read-only
  STATUS current
  DESCRIPTION "Expected but intentionally omitted."
  ::= { fixtureRoot 2 }
fixtureNotice NOTIFICATION-TYPE
  OBJECTS { fixtureValue, fixtureMissing }
  STATUS current
  DESCRIPTION "Fixture notification description."
  ::= { fixtureRoot 0 1 }
END`,
      },
    ]);
    await engine.traps.startReceiver({ port, transport: 'udp4', disableAuthorization: true });
    try {
      await engine.traps.send({
        target: { host: '127.0.0.1', port, version: 'v2c', community: 'public' },
        kind: 'trap',
        trapOid: '1.3.6.1.4.1.424242.0.1',
        varbinds: [
          { oid: '1.3.6.1.4.1.424242.1.0', type: 'Integer', value: '7' },
          { oid: '1.3.6.1.4.1.424242.99.0', type: 'OctetString', value: 'extra' },
        ],
      });
      let records = await engine.traps.list();
      for (let attempt = 0; attempt < 20 && records.length === 0; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        records = await engine.traps.list();
      }
      expect(records[0]).toMatchObject({
        trapName: 'fixtureNotice',
        trapDescription: 'Fixture notification description.',
        expectedObjects: expect.arrayContaining([
          expect.stringContaining('fixtureValue|'),
          expect.stringContaining('fixtureMissing|'),
        ]),
        missingObjects: [expect.stringContaining('fixtureMissing|')],
        extraObjects: expect.arrayContaining(['fixtureRoot.99.0']),
      });
    } finally {
      await engine.traps.stopReceiver();
    }

    const restarted = createEngine(createNodeTransport({ dataDir: directory }), { dbPath });
    await expect(restarted.traps.list()).resolves.toMatchObject([
      { trapName: 'fixtureNotice', missingObjects: [expect.stringContaining('fixtureMissing|')] },
    ]);
  });
});
