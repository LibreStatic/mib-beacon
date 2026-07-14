import { afterEach, describe, expect, it } from 'vitest';
import { createSocket } from 'node:dgram';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import snmp from 'net-snmp';
import { createNodeTransport } from '@mibbeacon/transport/node';
import type { SecretStore } from '@mibbeacon/transport';
import { createEngine } from './engine';

interface FixtureMib {
  registerProvider(provider: unknown): void;
  getTableColumnCells(name: string, column: number): Record<string, unknown>;
  lookup(oid: string): unknown;
}

interface FixtureAgent {
  getMib(): FixtureMib;
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

async function rowStatusAgent(): Promise<{ agent: FixtureAgent; port: number }> {
  const port = await freeUdpPort();
  const createAgent = snmp.createAgent as unknown as (
    options: Record<string, unknown>,
    callback: (error?: Error) => void,
  ) => FixtureAgent;
  const agent = createAgent(
    { port, address: '127.0.0.1', transport: 'udp4' },
    () => undefined,
  );
  agent.getMib().registerProvider({
    name: 'fixtureRowEntry',
    type: snmp.MibProviderType.Table,
    oid: '1.3.6.1.4.1.8072.9999.1.1',
    maxAccess: snmp.MaxAccess['not-accessible'],
    tableColumns: [
      {
        number: 1,
        name: 'fixtureRowIndex',
        type: snmp.ObjectType.Integer,
        maxAccess: snmp.MaxAccess['not-accessible'],
      },
      {
        number: 2,
        name: 'fixtureRowName',
        type: snmp.ObjectType.OctetString,
        maxAccess: snmp.MaxAccess['read-create'],
        defVal: Buffer.from('default'),
      },
      {
        number: 3,
        name: 'fixtureRowStatus',
        type: snmp.ObjectType.Integer,
        maxAccess: snmp.MaxAccess['read-create'],
        rowStatus: true,
      },
    ],
    tableIndex: [{ columnName: 'fixtureRowIndex' }],
  });
  agent.getAuthorizer().addCommunity('public');
  agents.push(agent);
  await new Promise((resolve) => setTimeout(resolve, 25));
  return { agent, port };
}

describe('real RowStatus fixture', () => {
  it('creates a row with required columns and destroys it through the engine', async () => {
    const fixture = await rowStatusAgent();
    const directory = await mkdtemp(join(tmpdir(), 'mibbeacon-row-status-fixture-'));
    const engine = createEngine(
      createNodeTransport({ dataDir: directory, secrets: encryptedSecrets() }),
      { dbPath: ':memory:' },
    );
    const agent = {
      host: '127.0.0.1',
      port: fixture.port,
      version: 'v2c' as const,
      community: 'public',
      timeoutMs: 250,
      retries: 0,
    };

    await expect(
      engine.ops.createTableRow({
        agent,
        rowStatusOid: '1.3.6.1.4.1.8072.9999.1.1.3.7',
        requiredColumns: [
          {
            oid: '1.3.6.1.4.1.8072.9999.1.1.2.7',
            type: 'OctetString',
            value: 'created by MIBbeacon',
          },
        ],
      }),
    ).resolves.toMatchObject({ mode: 'createAndGo' });

    // node-net-snmp retains the accepted creation action in its in-memory MIB,
    // so existence plus the required column is stronger fixture evidence than
    // assuming the stored status has already been normalized to active(1).
    expect(fixture.agent.getMib().getTableColumnCells('fixtureRowEntry', 2)).toEqual([
      'created by MIBbeacon',
    ]);
    expect(fixture.agent.getMib().getTableColumnCells('fixtureRowEntry', 3)).toEqual([
      snmp.RowStatus.createAndGo,
    ]);
    expect(fixture.agent.getMib().lookup('1.3.6.1.4.1.8072.9999.1.1.3.7')).toBeDefined();
    await engine.ops.deleteTableRow({
      agent,
      rowStatusOid: '1.3.6.1.4.1.8072.9999.1.1.3.7',
    });
    expect(fixture.agent.getMib().lookup('1.3.6.1.4.1.8072.9999.1.1.3.7')).toBeNull();
  });
});
