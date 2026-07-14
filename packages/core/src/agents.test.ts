import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeTransport, nodeStorageFactory } from '@mibbeacon/transport/node';
import type { SecretStore } from '@mibbeacon/transport';
import type { AgentSpec } from './snmp/types';
import { createEngine } from './engine';

function encryptedSecrets(values = new Map<string, string>()): SecretStore {
  return {
    set: async (key, value) => void values.set(key, value),
    get: async (key) => values.get(key) ?? null,
    delete: async (key) => void values.delete(key),
    isEncrypted: () => true,
  };
}

describe('agent profiles and groups', () => {
  it('stores v2c secrets only in SecretStore, preserves/replaces them, and deletes them', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mibbeacon-agents-'));
    const database = join(directory, 'mibbeacon.db');
    const secretValues = new Map<string, string>();
    const engine = createEngine(
      createNodeTransport({ dataDir: directory, secrets: encryptedSecrets(secretValues) }),
      { dbPath: database },
    );

    const created = await engine.agents.create({
      profile: {
        name: 'Core switch',
        host: 'switch.example',
        port: 161,
        transport: 'udp4',
        version: 'v2c',
        timeoutMs: 3000,
        retries: 2,
        getBulkNonRepeaters: 0,
        getBulkMaxRepetitions: 25,
      },
      secrets: { community: 'private-community' },
    });
    expect(created).toMatchObject({ name: 'Core switch', hasCommunity: true });
    expect(created).not.toHaveProperty('community');
    expect([...secretValues.values()]).toEqual(['private-community']);

    const db = nodeStorageFactory.open(database);
    expect(JSON.stringify(db.all('SELECT * FROM agents'))).not.toContain('private-community');
    db.close();

    await engine.agents.update(created.id, { profile: { name: 'Renamed switch' } });
    expect([...secretValues.values()]).toEqual(['private-community']);
    await engine.agents.update(created.id, { secrets: { community: 'replacement-community' } });
    expect([...secretValues.values()]).toEqual(['replacement-community']);

    await engine.agents.delete(created.id);
    expect(await engine.agents.get(created.id)).toBeNull();
    expect(secretValues.size).toBe(0);
  });

  it('round-trips v3 configuration, groups, and last-used ordering without exposing passwords', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mibbeacon-agent-groups-'));
    const resolvedAgents: AgentSpec[] = [];
    const engine = createEngine(
      createNodeTransport({ dataDir: directory, secrets: encryptedSecrets() }),
      {
        dbPath: join(directory, 'mibbeacon.db'),
        agentTester: async (agent) => {
          resolvedAgents.push(agent);
          return [];
        },
      },
    );
    const first = await engine.agents.create({
      profile: { name: 'First', host: '2001:db8::1', transport: 'udp6', version: 'v3' },
      v3: {
        user: 'operator',
        level: 'authPriv',
        authProtocol: 'sha256',
        privProtocol: 'aes',
        context: 'tenant-a',
      },
      secrets: { authKey: 'auth-password', privKey: 'privacy-password' },
    });
    const second = await engine.agents.create({
      profile: { name: 'Second', host: '192.0.2.20', version: 'v1' },
      secrets: { community: 'legacy' },
    });
    await engine.ops.get({ agentId: first.id, oids: ['1.3.6.1.2.1.1.1.0'] });
    const resolved = resolvedAgents[0]!;
    expect(resolved.v3).toMatchObject({
      user: 'operator',
      level: 'authPriv',
      authProtocol: 'sha256',
      authKey: 'auth-password',
      privProtocol: 'aes',
      privKey: 'privacy-password',
      context: 'tenant-a',
    });
    expect(first).toMatchObject({ hasAuthKey: true, hasPrivKey: true });
    expect(JSON.stringify(first)).not.toContain('password');

    const group = await engine.agents.groups.create({
      name: 'Lab',
      agentIds: [first.id, second.id],
    });
    expect(await engine.agents.groups.get(group.id)).toMatchObject({
      name: 'Lab',
      agentIds: [first.id, second.id],
    });
    await engine.agents.groups.update(group.id, { name: 'Primary lab', agentIds: [second.id] });
    expect((await engine.agents.groups.list())[0]).toMatchObject({
      name: 'Primary lab',
      agentIds: [second.id],
    });

    await engine.agents.markUsed(first.id);
    expect((await engine.agents.list())[0]?.id).toBe(first.id);
    await engine.agents.groups.delete(group.id);
    expect(await engine.agents.groups.get(group.id)).toBeNull();
  });

  it('rejects secret persistence when encrypted storage is unavailable', async () => {
    const engine = createEngine(createNodeTransport({ dataDir: tmpdir() }), { dbPath: ':memory:' });
    await expect(
      engine.agents.create({
        profile: { name: 'Unsafe', host: '127.0.0.1', version: 'v2c' },
        secrets: { community: 'do-not-store' },
      }),
    ).rejects.toMatchObject({ code: 'SECRET_STORAGE_UNAVAILABLE' });
  });

  it('tests the three standard system objects and returns decoded latency detail', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mibbeacon-agent-test-'));
    const requests: string[][] = [];
    const engine = createEngine(
      createNodeTransport({ dataDir: directory, secrets: encryptedSecrets() }),
      {
        dbPath: join(directory, 'mibbeacon.db'),
        agentTester: async (_agent, oids) => {
          requests.push(oids);
          return oids.map((oid, index) => ({
            oid,
            type: 4,
            typeName: 'OctetString',
            value: `value-${index}`,
            isError: false,
          }));
        },
      },
    );
    const profile = await engine.agents.create({
      profile: { name: 'Testable', host: '127.0.0.1', version: 'v2c' },
      secrets: { community: 'public' },
    });

    const result = await engine.agents.test(profile.id);
    expect(requests).toEqual([['1.3.6.1.2.1.1.1.0', '1.3.6.1.2.1.1.3.0', '1.3.6.1.2.1.1.2.0']]);
    expect(result).toMatchObject({ latencyMs: expect.any(Number) });
    expect(result.varbinds.map(({ name }) => name)).toEqual([
      'sysDescr.0',
      'sysUpTime.0',
      'sysObjectID.0',
    ]);
  });

  it('runs an operation by saved profile id without exposing its credentials to the caller', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mibbeacon-agent-target-'));
    const seen: unknown[] = [];
    const engine = createEngine(
      createNodeTransport({ dataDir: directory, secrets: encryptedSecrets() }),
      {
        dbPath: join(directory, 'mibbeacon.db'),
        agentTester: async (agent, oids) => {
          seen.push(agent);
          return oids.map((oid) => ({
            oid,
            type: 2,
            typeName: 'Integer',
            value: 1,
            isError: false,
          }));
        },
      },
    );
    const saved = await engine.agents.create({
      profile: { name: 'Saved target', host: '192.0.2.10', version: 'v2c' },
      secrets: { community: 'inside-engine-only' },
    });

    await expect(engine.ops.get({ agentId: saved.id, oids: ['1.3.6.1.2.1.1.1.0'] })).resolves.toHaveLength(1);
    expect(seen).toEqual([
      expect.objectContaining({ host: '192.0.2.10', community: 'inside-engine-only' }),
    ]);
    expect((await engine.agents.list())[0]).toMatchObject({
      id: saved.id,
      lastUsedAt: expect.any(Number),
    });
  });

  it('streams generic operation batches and completion statistics', async () => {
    const engine = createEngine(
      createNodeTransport({ dataDir: tmpdir(), secrets: encryptedSecrets() }),
      {
        dbPath: ':memory:',
        agentTester: async (_agent, oids) =>
          oids.map((oid) => ({
            oid,
            type: 2,
            typeName: 'Integer',
            value: 7,
            isError: false,
          })),
      },
    );
    const events: { handleId?: string; kind: string; payload?: unknown }[] = [];
    let finish!: () => void;
    const terminal = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const unsubscribe = engine.events.subscribe('ops', (event) => {
      events.push(event);
      if (event.kind === 'done') finish();
    });

    const handle = await engine.ops.start({
      kind: 'get',
      agent: { host: '127.0.0.1', version: 'v2c', community: 'public' },
      oids: ['1.3.6.1.2.1.1.1.0'],
    });
    await terminal;
    unsubscribe();

    expect(events.map(({ kind }) => kind)).toEqual(['pdu', 'pdu', 'batch', 'done']);
    expect(JSON.stringify(events)).not.toContain('public');
    expect(events).toContainEqual(
      expect.objectContaining({ handleId: handle.handleId, kind: 'batch' }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        handleId: handle.handleId,
        kind: 'done',
        payload: expect.objectContaining({ count: 1, pduCount: 1, durationMs: expect.any(Number) }),
      }),
    );
  });

  it('fans a group operation out with bounded concurrency and per-agent status', async () => {
    let active = 0;
    let maxActive = 0;
    const engine = createEngine(
      createNodeTransport({ dataDir: tmpdir(), secrets: encryptedSecrets() }),
      {
        dbPath: ':memory:',
        agentTester: async (agent, oids) => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
          if (agent.host.endsWith('.3')) throw new Error('deliberately unreachable');
          return oids.map((oid) => ({
            oid,
            type: 2,
            typeName: 'Integer',
            value: 1,
            isError: false,
          }));
        },
      },
    );
    const profiles = await Promise.all(
      [1, 2, 3].map((suffix) =>
        engine.agents.create({
          profile: { name: `Agent ${suffix}`, host: `192.0.2.${suffix}`, version: 'v2c' },
          secrets: { community: 'public' },
        }),
      ),
    );
    const group = await engine.agents.groups.create({
      name: 'Three agents',
      agentIds: profiles.map(({ id }) => id),
    });
    const events: { kind: string; payload?: unknown }[] = [];
    let finish!: () => void;
    const terminal = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const unsubscribe = engine.events.subscribe('ops', (event) => {
      events.push(event);
      if (event.kind === 'done') finish();
    });

    await engine.ops.start({
      kind: 'get',
      groupId: group.id,
      concurrency: 2,
      oids: ['1.3.6.1.2.1.1.1.0'],
    });
    await terminal;
    unsubscribe();

    expect(maxActive).toBe(2);
    expect(events.filter(({ kind }) => kind === 'batch')).toHaveLength(2);
    expect(
      events
        .filter(({ kind }) => kind === 'batch')
        .flatMap(({ payload }) => payload as { agentId?: string }[])
        .every(({ agentId }) => profiles.some((profile) => profile.id === agentId)),
    ).toBe(true);
    expect(events.filter(({ kind }) => kind === 'agent-status')).toHaveLength(6);
    expect(events.at(-1)).toMatchObject({
      kind: 'done',
      payload: { succeeded: 2, failed: 1, count: 2 },
    });
  });

  it('validates version-dependent credentials and unavailable DES before persistence', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mibbeacon-agent-validation-'));
    const secretValues = new Map<string, string>();
    const transport = createNodeTransport({
      dataDir: directory,
      secrets: encryptedSecrets(secretValues),
    });
    const engine = createEngine(transport, { dbPath: join(directory, 'mibbeacon.db') });

    await expect(
      engine.agents.create({
        profile: { name: 'No community', host: '127.0.0.1', version: 'v2c' },
      }),
    ).rejects.toThrow(/community/i);
    await expect(
      engine.agents.create({
        profile: { name: 'No auth key', host: '127.0.0.1', version: 'v3' },
        v3: { user: 'operator', level: 'authNoPriv', authProtocol: 'sha256' },
      }),
    ).rejects.toThrow(/authentication password/i);
    if (!transport.crypto.hasCipher('des-cbc')) {
      await expect(
        engine.agents.create({
          profile: { name: 'Unavailable DES', host: '127.0.0.1', version: 'v3' },
          v3: {
            user: 'operator',
            level: 'authPriv',
            authProtocol: 'sha256',
            privProtocol: 'des',
          },
          secrets: { authKey: 'authentication', privKey: 'privacy-key' },
        }),
      ).rejects.toThrow(/DES.*unavailable/i);
    }

    const valid = await engine.agents.create({
      profile: { name: 'Relevant secrets only', host: '127.0.0.1', version: 'v2c' },
      secrets: {
        community: 'public',
        authKey: 'must-not-be-stored',
        privKey: 'must-not-be-stored',
      },
    });
    expect(valid).toMatchObject({
      hasCommunity: true,
      hasAuthKey: false,
      hasPrivKey: false,
    });
    await expect(
      engine.agents.update(valid.id, { clearSecrets: ['community'] }),
    ).rejects.toThrow(/community/i);
    expect(valid.hasCommunity).toBe(true);
    expect([...secretValues.values()]).toEqual(['public']);

    const noAuth = await engine.agents.update(valid.id, {
      profile: { version: 'v3' },
      v3: { user: 'observer', level: 'noAuthNoPriv' },
    });
    expect(noAuth).toMatchObject({
      version: 'v3',
      hasCommunity: false,
      hasAuthKey: false,
      hasPrivKey: false,
    });
  });
});
