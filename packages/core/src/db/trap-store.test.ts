import { describe, expect, it } from 'vitest';
import { createNodeTransport, nodeStorageFactory } from '@mibbeacon/transport/node';
import type { SecretStore } from '@mibbeacon/transport';
import { runMigrations } from './migrate';
import { TrapStore } from './trap-store';
import type { TrapRecord } from '../snmp/receiver';

function secretStore(): SecretStore & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    set: async (key, value) => void values.set(key, value),
    get: async (key) => values.get(key) ?? null,
    delete: async (key) => void values.delete(key),
    isEncrypted: () => true,
  };
}

function trap(index: number, patch: Partial<TrapRecord> = {}): TrapRecord {
  return {
    id: `trap-${index.toString().padStart(3, '0')}`,
    receivedAt: index,
    sourceAddress: index % 2 ? '192.0.2.1' : '198.51.100.8',
    sourcePort: 1000 + index,
    version: 1,
    pduType: 167,
    trapOid: '1.3.6.1.6.3.1.1.5.3',
    trapName: 'linkDown',
    varbinds: [
      {
        oid: `1.3.6.1.2.1.2.2.1.8.${index}`,
        type: 2,
        typeName: 'Integer',
        value: index % 2 ? 'down' : 'up',
        isError: false,
      },
    ],
    ...patch,
  };
}

describe('TrapStore', () => {
  it('persists, searches, marks read, and prunes the oldest records', () => {
    const db = nodeStorageFactory.open(':memory:');
    runMigrations(db);
    let now = 10_000;
    const store = new TrapStore(db, createNodeTransport(), () => now++);
    for (let index = 1; index <= 105; index++) store.insert(trap(index), 100);
    expect(store.count()).toBe(100);
    expect(store.list(200).at(-1)?.id).toBe('trap-006');
    expect(store.query({ source: '192.0.2', text: 'down', trap: 'link', limit: 200 })).toHaveLength(
      50,
    );
    const selected = store.list(2).map(({ id }) => id);
    store.markRead(selected);
    expect(store.unreadCount()).toBe(98);
    expect(store.query({ unread: false })).toHaveLength(2);
    store.markRead([selected[0]!], false);
    expect(store.unreadCount()).toBe(99);
    store.delete([selected[0]!]);
    expect(store.count()).toBe(99);
    expect(store.list(200).some(({ id }) => id === selected[0])).toBe(false);
  });

  it('keeps v3 keys out of SQLite while resolving them for receiver startup', async () => {
    const db = nodeStorageFactory.open(':memory:');
    runMigrations(db);
    const secrets = secretStore();
    const store = new TrapStore(db, createNodeTransport({ secrets }));
    await store.upsertV3User({
      name: 'trap-user',
      level: 'authPriv',
      authProtocol: 'sha',
      authKey: 'auth-secret',
      privProtocol: 'aes',
      privKey: 'priv-secret',
    });
    expect(store.listV3Users()).toMatchObject([
      { name: 'trap-user', hasAuthKey: true, hasPrivKey: true },
    ]);
    expect(JSON.stringify(db.all('SELECT * FROM trap_v3_users'))).not.toContain('auth-secret');
    await expect(store.resolveV3Users()).resolves.toMatchObject([
      { name: 'trap-user', authKey: 'auth-secret', privKey: 'priv-secret' },
    ]);
    await store.removeV3User('trap-user');
    expect(secrets.values.size).toBe(0);
  });

  it('does not mutate stored v3 secrets when an upsert is rejected', async () => {
    const db = nodeStorageFactory.open(':memory:');
    runMigrations(db);
    const secrets = secretStore();
    const store = new TrapStore(db, createNodeTransport({ secrets }));
    await store.upsertV3User({
      name: 'trap-user',
      level: 'authNoPriv',
      authProtocol: 'sha',
      authKey: 'confirmed-secret',
    });

    await expect(
      store.upsertV3User({
        name: 'trap-user',
        level: 'authPriv',
        authProtocol: 'sha',
        authKey: 'rejected-secret',
      }),
    ).rejects.toThrow();

    await expect(store.resolveV3Users()).resolves.toMatchObject([
      { name: 'trap-user', level: expect.any(Number), authKey: 'confirmed-secret' },
    ]);
    expect([...secrets.values.values()]).not.toContain('rejected-secret');
  });

  it('rolls back earlier v3 secret writes when a later secret-store write fails', async () => {
    const db = nodeStorageFactory.open(':memory:');
    runMigrations(db);
    const secrets = secretStore();
    const store = new TrapStore(db, createNodeTransport({ secrets }));
    await store.upsertV3User({
      name: 'trap-user',
      level: 'authPriv',
      authProtocol: 'sha',
      authKey: 'confirmed-auth',
      privProtocol: 'aes',
      privKey: 'confirmed-priv',
    });
    const normalSet = secrets.set.bind(secrets);
    secrets.set = async (key, value) => {
      if (key.endsWith('/priv-key') && value === 'failed-priv')
        throw new Error('secret write failed');
      await normalSet(key, value);
    };

    await expect(
      store.upsertV3User({
        name: 'trap-user',
        level: 'authPriv',
        authProtocol: 'sha',
        authKey: 'temporary-auth',
        privProtocol: 'aes',
        privKey: 'failed-priv',
      }),
    ).rejects.toThrow('secret write failed');
    await expect(store.resolveV3Users()).resolves.toMatchObject([
      { authKey: 'confirmed-auth', privKey: 'confirmed-priv' },
    ]);
  });

  it('rolls back v3 secrets when the database write fails after secret mutation', async () => {
    const db = nodeStorageFactory.open(':memory:');
    runMigrations(db);
    const secrets = secretStore();
    const store = new TrapStore(db, createNodeTransport({ secrets }));
    await store.upsertV3User({
      name: 'trap-user',
      level: 'authNoPriv',
      authProtocol: 'sha',
      authKey: 'confirmed-auth',
    });
    const normalRun = db.run.bind(db);
    db.run = (sql, params) => {
      if (sql.includes('INSERT INTO trap_v3_users')) throw new Error('db write failed');
      return normalRun(sql, params);
    };

    await expect(
      store.upsertV3User({
        name: 'trap-user',
        level: 'authNoPriv',
        authProtocol: 'sha256',
        authKey: 'temporary-auth',
      }),
    ).rejects.toThrow('db write failed');
    expect(secrets.values.get('trap-users/trap-user/auth-key')).toBe('confirmed-auth');
  });

  it('restores already-deleted v3 keys when a later key deletion fails', async () => {
    const db = nodeStorageFactory.open(':memory:');
    runMigrations(db);
    const secrets = secretStore();
    const store = new TrapStore(db, createNodeTransport({ secrets }));
    await store.upsertV3User({
      name: 'trap-user',
      level: 'authPriv',
      authProtocol: 'sha',
      authKey: 'confirmed-auth',
      privProtocol: 'aes',
      privKey: 'confirmed-priv',
    });
    const normalDelete = secrets.delete.bind(secrets);
    let failPriv = true;
    secrets.delete = async (key) => {
      if (failPriv && key.endsWith('/priv-key')) {
        failPriv = false;
        throw new Error('secret delete failed');
      }
      await normalDelete(key);
    };

    await expect(store.removeV3User('trap-user')).rejects.toThrow('secret delete failed');
    await expect(store.resolveV3Users()).resolves.toMatchObject([
      { authKey: 'confirmed-auth', privKey: 'confirmed-priv' },
    ]);
  });

  it('reports an unknown outcome when v3 update compensation also fails', async () => {
    const db = nodeStorageFactory.open(':memory:');
    runMigrations(db);
    const secrets = secretStore();
    const store = new TrapStore(db, createNodeTransport({ secrets }));
    await store.upsertV3User({
      name: 'trap-user',
      level: 'authPriv',
      authProtocol: 'sha',
      authKey: 'confirmed-auth',
      privProtocol: 'aes',
      privKey: 'confirmed-priv',
    });
    const normalSet = secrets.set.bind(secrets);
    let compensating = false;
    secrets.set = async (key, value) => {
      if (key.endsWith('/priv-key') && value === 'failed-priv') {
        compensating = true;
        throw new Error('primary secret failure');
      }
      if (compensating && key.endsWith('/auth-key') && value === 'confirmed-auth')
        throw new Error('compensation failure');
      await normalSet(key, value);
    };
    await expect(
      store.upsertV3User({
        name: 'trap-user',
        level: 'authPriv',
        authProtocol: 'sha',
        authKey: 'temporary-auth',
        privProtocol: 'aes',
        privKey: 'failed-priv',
      }),
    ).rejects.toThrow('outcome unknown');
  });

  it('restores deleted v3 keys when database removal fails', async () => {
    const db = nodeStorageFactory.open(':memory:');
    runMigrations(db);
    const secrets = secretStore();
    const store = new TrapStore(db, createNodeTransport({ secrets }));
    await store.upsertV3User({
      name: 'trap-user',
      level: 'authNoPriv',
      authProtocol: 'sha',
      authKey: 'confirmed-auth',
    });
    const normalRun = db.run.bind(db);
    db.run = (sql, params) => {
      if (sql.includes('DELETE FROM trap_v3_users')) throw new Error('db delete failed');
      return normalRun(sql, params);
    };

    await expect(store.removeV3User('trap-user')).rejects.toThrow('db delete failed');
    await expect(store.resolveV3Users()).resolves.toMatchObject([
      { name: 'trap-user', authKey: 'confirmed-auth' },
    ]);
  });

  it('reports an unknown outcome when v3 removal compensation also fails', async () => {
    const db = nodeStorageFactory.open(':memory:');
    runMigrations(db);
    const secrets = secretStore();
    const store = new TrapStore(db, createNodeTransport({ secrets }));
    await store.upsertV3User({
      name: 'trap-user',
      level: 'authPriv',
      authProtocol: 'sha',
      authKey: 'confirmed-auth',
      privProtocol: 'aes',
      privKey: 'confirmed-priv',
    });
    const normalDelete = secrets.delete.bind(secrets);
    const normalSet = secrets.set.bind(secrets);
    let compensating = false;
    secrets.delete = async (key) => {
      if (key.endsWith('/priv-key')) {
        compensating = true;
        throw new Error('primary delete failure');
      }
      await normalDelete(key);
    };
    secrets.set = async (key, value) => {
      if (compensating && key.endsWith('/auth-key')) throw new Error('compensation failure');
      await normalSet(key, value);
    };
    await expect(store.removeV3User('trap-user')).rejects.toThrow('outcome unknown');
  });

  it('round-trips saved filters, sender presets, and rules', () => {
    const db = nodeStorageFactory.open(':memory:');
    runMigrations(db);
    const store = new TrapStore(db, createNodeTransport(), () => 42);
    const filter = store.saveFilter('Link failures', { trap: 'linkDown', unread: true });
    const preset = store.savePreset('Test linkDown', 'agent-1', {
      kind: 'trap',
      trapOid: '1.3.6.1.6.3.1.1.5.3',
      varbinds: [],
    });
    const rule = store.createRule({
      name: 'Critical link',
      enabled: true,
      priority: 10,
      condition: { trapOidGlob: '*.5.3' },
      actions: { severity: 'critical', color: '#ef4444', notify: true },
    });
    expect(store.listFilters()).toEqual([filter]);
    expect(store.listPresets()).toEqual([preset]);
    expect(store.listRules()).toEqual([rule]);
    expect(store.updateRule(rule.id, { enabled: false })).toMatchObject({ enabled: false });
  });

  it('searches ten thousand persisted varbind payloads within the desktop budget', () => {
    const db = nodeStorageFactory.open(':memory:');
    runMigrations(db);
    db.transaction(() => {
      for (let index = 0; index < 10_000; index++) {
        db.run(
          `INSERT INTO traps
           (id, received_at, source_address, source_port, version, pdu_type, trap_oid, trap_name, varbinds_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            `bulk-${index}`,
            index,
            '192.0.2.1',
            162,
            1,
            167,
            '1.3.6.1.6.3.1.1.5.3',
            'linkDown',
            JSON.stringify([{ oid: '1.3.6.1.2.1.1.1.0', value: `device-${index}` }]),
          ],
        );
      }
    });
    const store = new TrapStore(db, createNodeTransport());
    const started = performance.now();
    const result = store.query({ text: 'device-9999', limit: 10 });
    const elapsed = performance.now() - started;
    expect(result).toHaveLength(1);
    expect(elapsed).toBeLessThan(500);
  });
});
