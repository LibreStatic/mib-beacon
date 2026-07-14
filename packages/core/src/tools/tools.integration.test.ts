import { afterEach, describe, expect, it } from 'vitest';
import { createSocket } from 'node:dgram';
import snmp from 'net-snmp';
import { createNodeTransport } from '@mibbeacon/transport/node';
import type { SecretStore } from '@mibbeacon/transport';
import { createEngine } from '../engine';

interface FixtureAgent {
  getMib(): {
    registerProviders(providers: unknown[]): void;
    registerProvider(provider: unknown): void;
    setScalarValue(name: string, value: unknown): void;
    addTableRow(name: string, row: unknown[]): void;
    setTableSingleCell(name: string, column: number, index: number[], value: unknown): void;
  };
  getAuthorizer(): { addCommunity(community: string): void };
  close(callback?: () => void): void;
}

const fixtures: FixtureAgent[] = [];
afterEach(async () => {
  await Promise.all(
    fixtures.splice(0).map(
      (agent) =>
        new Promise<void>((resolve) => {
          agent.close(resolve);
          setTimeout(resolve, 100);
        }),
    ),
  );
});

function encryptedSecrets(): SecretStore {
  const values = new Map<string, string>();
  return {
    set: async (key, value) => {
      values.set(key, value);
    },
    get: async (key) => values.get(key) ?? null,
    delete: async (key) => {
      values.delete(key);
    },
    isEncrypted: () => true,
  };
}

async function freePort(): Promise<number> {
  const socket = createSocket('udp4');
  await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve));
  const address = socket.address();
  const port = typeof address === 'string' ? 0 : address.port;
  await new Promise<void>((resolve) => socket.close(resolve));
  return port;
}

async function startFixture(address: string, port: number, community: string, description: string) {
  const moduleStore = snmp.createModuleStore() as unknown as {
    getProvidersForModule(name: string): unknown[];
  };
  const createAgent = snmp.createAgent as unknown as (
    options: Record<string, unknown>,
    callback: (error?: Error) => void,
  ) => FixtureAgent;
  const agent = createAgent({ port, address, transport: 'udp4' }, () => undefined);
  agent.getMib().registerProviders(moduleStore.getProvidersForModule('SNMPv2-MIB'));
  agent.getMib().setScalarValue('sysDescr', description);
  agent.getMib().setScalarValue('sysName', `device-${address}`);
  agent.getAuthorizer().addCommunity(community);
  fixtures.push(agent);
  await new Promise((resolve) => setTimeout(resolve, 30));
  return agent;
}

function addLegacyPortFixture(agent: FixtureAgent) {
  const access = snmp.MaxAccess['read-only'];
  agent.getMib().registerProvider({
    name: 'ifTableFixture',
    type: snmp.MibProviderType.Table,
    oid: '1.3.6.1.2.1.2.2.1',
    maxAccess: snmp.MaxAccess['not-accessible'],
    tableColumns: [
      { number: 1, name: 'ifIndex', type: snmp.ObjectType.Integer, maxAccess: access },
      { number: 2, name: 'ifDescr', type: snmp.ObjectType.OctetString, maxAccess: access },
      { number: 5, name: 'ifSpeed', type: snmp.ObjectType.Gauge, maxAccess: access },
      { number: 7, name: 'ifAdminStatus', type: snmp.ObjectType.Integer, maxAccess: access },
      { number: 8, name: 'ifOperStatus', type: snmp.ObjectType.Integer, maxAccess: access },
      { number: 10, name: 'ifInOctets', type: snmp.ObjectType.Counter, maxAccess: access },
      { number: 14, name: 'ifInErrors', type: snmp.ObjectType.Counter, maxAccess: access },
      { number: 16, name: 'ifOutOctets', type: snmp.ObjectType.Counter, maxAccess: access },
      { number: 20, name: 'ifOutErrors', type: snmp.ObjectType.Counter, maxAccess: access },
    ],
    tableIndex: [{ columnName: 'ifIndex' }],
  });
  agent
    .getMib()
    .addTableRow('ifTableFixture', [1, 'eth-fixture', 1_000_000_000, 1, 1, 100, 0, 200, 0]);
  agent.getMib().registerProvider({
    name: 'ifXTableFixture',
    type: snmp.MibProviderType.Table,
    oid: '1.3.6.1.2.1.31.1.1.1',
    maxAccess: snmp.MaxAccess['not-accessible'],
    tableColumns: [
      { number: 1, name: 'ifName', type: snmp.ObjectType.OctetString, maxAccess: access },
      { number: 6, name: 'ifHCInOctets', type: snmp.ObjectType.Counter64, maxAccess: access },
      { number: 10, name: 'ifHCOutOctets', type: snmp.ObjectType.Counter64, maxAccess: access },
      { number: 15, name: 'ifHighSpeed', type: snmp.ObjectType.Gauge, maxAccess: access },
      { number: 18, name: 'ifAlias', type: snmp.ObjectType.OctetString, maxAccess: access },
    ],
    tableAugments: 'ifTableFixture',
  });
  agent
    .getMib()
    .addTableRow('ifXTableFixture', [
      1,
      'eth-fixture',
      counter64(100),
      counter64(200),
      1_000,
      'uplink',
    ]);
}

function counter64(value: number): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(value));
  return buffer;
}

describe('tools against real UDP agents', () => {
  it('discovers three agents with different credential attribution and compares live walks', async () => {
    const port = await freePort();
    await Promise.all([
      startFixture('127.0.0.1', port, 'alpha', 'same-prefix-alpha'),
      startFixture('127.0.0.2', port, 'bravo', 'different-bravo'),
      startFixture('127.0.0.3', port, 'charlie', 'different-charlie'),
    ]);
    const engine = createEngine(createNodeTransport({ secrets: encryptedSecrets() }), {
      dbPath: ':memory:',
    });
    const profiles = await Promise.all(
      ['alpha', 'bravo', 'charlie'].map((community, index) =>
        engine.agents.create({
          profile: {
            name: community,
            host: `127.0.0.${index + 1}`,
            port,
            version: 'v2c',
            timeoutMs: 120,
            retries: 0,
          },
          secrets: { community },
        }),
      ),
    );
    const results: Array<{ ip: string; credentialLabel: string }> = [];
    let resolveDone!: () => void;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    let handleId = '';
    const off = engine.events.subscribe('tools', (event) => {
      if (event.handleId !== handleId) return;
      if (event.kind === 'discovery-result')
        results.push(event.payload as (typeof results)[number]);
      if (event.kind === 'done') resolveDone();
    });
    const started = await engine.tools.discovery.start({
      target: '127.0.0.1-127.0.0.3',
      credentials: profiles.map((profile) => ({ agentId: profile.id, label: profile.name })),
      concurrency: 2,
    });
    handleId = started.handleId;
    await done;
    off();

    expect(results.sort((a, b) => a.ip.localeCompare(b.ip))).toEqual([
      {
        ip: '127.0.0.1',
        credentialLabel: 'alpha',
        credentialAgentId: profiles[0]!.id,
        version: 'v2c',
        latencyMs: expect.any(Number),
        sysDescr: 'same-prefix-alpha',
        sysObjectId: expect.any(String),
        sysUpTime: expect.any(String),
        sysName: 'device-127.0.0.1',
      },
      {
        ip: '127.0.0.2',
        credentialLabel: 'bravo',
        credentialAgentId: profiles[1]!.id,
        version: 'v2c',
        latencyMs: expect.any(Number),
        sysDescr: 'different-bravo',
        sysObjectId: expect.any(String),
        sysUpTime: expect.any(String),
        sysName: 'device-127.0.0.2',
      },
      {
        ip: '127.0.0.3',
        credentialLabel: 'charlie',
        credentialAgentId: profiles[2]!.id,
        version: 'v2c',
        latencyMs: expect.any(Number),
        sysDescr: 'different-charlie',
        sysObjectId: expect.any(String),
        sysUpTime: expect.any(String),
        sysName: 'device-127.0.0.3',
      },
    ]);

    let compareHandle = '';
    let compared!: (rows: Awaited<ReturnType<typeof engine.tools.compare.live>>) => void;
    const comparedRows = new Promise<Awaited<ReturnType<typeof engine.tools.compare.live>>>(
      (resolve) => {
        compared = resolve;
      },
    );
    const offCompare = engine.events.subscribe('tools', (event) => {
      if (event.handleId === compareHandle && event.kind === 'compare-result') {
        compared(event.payload as Awaited<ReturnType<typeof engine.tools.compare.live>>);
      }
    });
    compareHandle = (
      await engine.tools.compare.start({
        agentAId: profiles[0]!.id,
        agentBId: profiles[1]!.id,
        baseOid: '1.3.6.1.2.1.1',
      })
    ).handleId;
    const diff = await comparedRows;
    offCompare();
    expect(diff).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          oid: '1.3.6.1.2.1.1.1.0',
          status: 'different',
          valueA: 'same-prefix-alpha',
          valueB: 'different-bravo',
        }),
      ]),
    );
  });

  it('cancels in-flight compare and port-view handles', async () => {
    const port = await freePort();
    const engine = createEngine(createNodeTransport({ secrets: encryptedSecrets() }), {
      dbPath: ':memory:',
    });
    const profiles = await Promise.all(
      ['A', 'B'].map((name) =>
        engine.agents.create({
          profile: { name, host: '127.0.0.1', port, version: 'v2c', timeoutMs: 1_000, retries: 0 },
          secrets: { community: 'nobody' },
        }),
      ),
    );
    for (const [kind, start, cancel] of [
      [
        'compare',
        () =>
          engine.tools.compare.start({
            agentAId: profiles[0]!.id,
            agentBId: profiles[1]!.id,
            baseOid: '1.3.6.1.2.1',
          }),
        (id: string) => engine.tools.compare.cancel(id),
      ],
      [
        'ports',
        () => engine.tools.ports.start(profiles[0]!.id),
        (id: string) => engine.tools.ports.cancel(id),
      ],
    ] as const) {
      let handleId = '';
      let finish!: () => void;
      const terminal = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const off = engine.events.subscribe('tools', (event) => {
        if (event.handleId === handleId && event.kind === 'cancelled') finish();
      });
      handleId = (await start()).handleId;
      await cancel(handleId);
      await Promise.race([
        terminal,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`${kind} cancellation timed out`)), 2_000),
        ),
      ]);
      off();
    }
  });

  it('inspects and rate-monitors a real UDP ifTable fixture', async () => {
    const port = await freePort();
    const fixture = await startFixture('127.0.0.1', port, 'ports', 'port fixture');
    addLegacyPortFixture(fixture);
    let now = 0;
    const engine = createEngine(createNodeTransport({ secrets: encryptedSecrets() }), {
      dbPath: ':memory:',
      tools: { now: () => now },
    });
    const profile = await engine.agents.create({
      profile: {
        name: 'ports',
        host: '127.0.0.1',
        port,
        version: 'v2c',
        timeoutMs: 250,
        retries: 0,
      },
      secrets: { community: 'ports' },
    });
    await expect(engine.tools.ports.inspect(profile.id)).resolves.toEqual([
      expect.objectContaining({
        index: '1',
        name: 'eth-fixture',
        adminStatus: 1,
        operStatus: 1,
        alias: 'uplink',
        speedBitsPerSecond: 1_000_000_000,
        highCapacity: true,
      }),
    ]);
    const series = await engine.tools.ports.monitor(profile.id, '1', true, 1_000);
    await engine.tools.polls.sampleNow(series.map((item) => item.id));
    fixture.getMib().setTableSingleCell('ifXTableFixture', 6, [1], counter64(1_100));
    fixture.getMib().setTableSingleCell('ifTableFixture', 14, [1], 2);
    fixture.getMib().setTableSingleCell('ifXTableFixture', 10, [1], counter64(2_200));
    fixture.getMib().setTableSingleCell('ifTableFixture', 20, [1], 3);
    now = 1_000;
    await engine.tools.polls.sampleNow(series.map((item) => item.id));

    await expect(engine.tools.ports.inspect(profile.id)).resolves.toEqual([
      expect.objectContaining({
        inBitsPerSecond: 8_000,
        outBitsPerSecond: 16_000,
        inUtilizationPercent: 0.0008,
        outUtilizationPercent: 0.0016,
        inErrorRate: 2,
        outErrorRate: 3,
      }),
    ]);
  });
});
