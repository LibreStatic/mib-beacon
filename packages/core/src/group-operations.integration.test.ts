import { afterEach, describe, expect, it } from 'vitest';
import { createSocket } from 'node:dgram';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import snmp from 'net-snmp';
import { createNodeTransport } from '@mibbeacon/transport/node';
import type { SecretStore } from '@mibbeacon/transport';
import { createEngine } from './engine';

interface FixtureAgent {
  getMib(): {
    registerProviders(providers: unknown[]): void;
    setScalarValue(name: string, value: unknown): void;
  };
  getAuthorizer(): { addCommunity(community: string): void };
  close(callback?: () => void): void;
}

const agents: FixtureAgent[] = [];

afterEach(async () => {
  await Promise.all(
    agents.splice(0).map(
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
    set: async (key, value) => void values.set(key, value),
    get: async (key) => values.get(key) ?? null,
    delete: async (key) => void values.delete(key),
    isEncrypted: () => true,
  };
}

async function freeUdpPort(): Promise<number> {
  const socket = createSocket('udp4');
  await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve));
  const address = socket.address();
  const port = typeof address === 'string' ? 0 : address.port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  return port;
}

async function fixtureAgent(name: string): Promise<{ agent: FixtureAgent; port: number }> {
  const port = await freeUdpPort();
  const moduleStore = snmp.createModuleStore() as unknown as {
    getProvidersForModule(name: string): unknown[];
  };
  const createAgent = snmp.createAgent as unknown as (
    options: Record<string, unknown>,
    callback: (error?: Error) => void,
  ) => FixtureAgent;
  const agent = createAgent(
    { port, address: '127.0.0.1', transport: 'udp4' },
    () => undefined,
  );
  agent.getMib().registerProviders(moduleStore.getProvidersForModule('SNMPv2-MIB'));
  agent.getMib().setScalarValue('sysDescr', name);
  agent.getAuthorizer().addCommunity('public');
  agents.push(agent);
  await new Promise((resolve) => setTimeout(resolve, 25));
  return { agent, port };
}

describe('real multi-agent fixture fan-out', () => {
  it('keeps two live agents successful when a third UDP target is unreachable', async () => {
    const [first, second, unreachablePort] = await Promise.all([
      fixtureAgent('fixture-one'),
      fixtureAgent('fixture-two'),
      freeUdpPort(),
    ]);
    const directory = await mkdtemp(join(tmpdir(), 'mibbeacon-group-fixture-'));
    const engine = createEngine(
      createNodeTransport({ dataDir: directory, secrets: encryptedSecrets() }),
      { dbPath: ':memory:' },
    );
    const profiles = await Promise.all(
      [first.port, second.port, unreachablePort].map((port, index) =>
        engine.agents.create({
          profile: {
            name: `Fixture ${index + 1}`,
            host: '127.0.0.1',
            port,
            version: 'v2c',
            timeoutMs: 100,
            retries: 0,
          },
          secrets: { community: 'public' },
        }),
      ),
    );
    const group = await engine.agents.groups.create({
      name: 'Fixture group',
      agentIds: profiles.map(({ id }) => id),
    });
    const events: { kind: string; payload?: unknown }[] = [];
    let finish!: () => void;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const off = engine.events.subscribe('ops', (event) => {
      events.push(event);
      if (event.kind === 'done') finish();
    });

    await engine.ops.start({
      kind: 'get',
      groupId: group.id,
      oids: ['1.3.6.1.2.1.1.1.0'],
    });
    await done;
    off();

    expect(events.at(-1)).toMatchObject({
      kind: 'done',
      payload: { succeeded: 2, failed: 1, count: 2 },
    });
    expect(
      events
        .filter(({ kind }) => kind === 'batch')
        .flatMap(({ payload }) => payload as { value: string }[])
        .map(({ value }) => value)
        .sort(),
    ).toEqual(['fixture-one', 'fixture-two']);
  });
});
