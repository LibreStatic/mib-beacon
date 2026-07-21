import { describe, expect, it } from 'vitest';
import { createNodeTransport, nodeStorageFactory } from '@mibbeacon/transport/node';
import type { SecretStore, StorageAdapter } from '@mibbeacon/transport';
import { AgentStore } from './agent-store';

function schema(db: StorageAdapter) {
  db.exec(`
    CREATE TABLE agents (id TEXT PRIMARY KEY, name TEXT NOT NULL, profile_json TEXT NOT NULL,
      community_ref TEXT, auth_ref TEXT, priv_ref TEXT, created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL, last_used_at INTEGER);
    CREATE TABLE agent_groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, agent_ids_json TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE operation_bookmarks (id TEXT, agent_id TEXT);
    CREATE TABLE poll_series (id TEXT, agent_id TEXT);
    CREATE TABLE trap_send_presets (id TEXT, agent_id TEXT);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
  `);
}

describe('AgentStore secret compensation', () => {
  it('returns exact normalized profile/group values without fallible post-commit reads', async () => {
    const values = new Map<string, string>();
    const secrets: SecretStore = {
      set: async (key, value) => void values.set(key, value),
      get: async (key) => values.get(key) ?? null,
      delete: async (key) => void values.delete(key),
      isEncrypted: () => true,
    };
    const db = nodeStorageFactory.open(':memory:');
    schema(db);
    let rejectReads = false;
    const wrapped: StorageAdapter = {
      ...db,
      exec: db.exec.bind(db),
      all: db.all.bind(db),
      transaction: db.transaction.bind(db),
      close: db.close.bind(db),
      get: (sql, params) => {
        if (rejectReads) throw new Error('post-commit read failed');
        return db.get(sql, params);
      },
      run: (sql, params) => {
        const result = db.run(sql, params);
        if (
          /^(INSERT INTO agents|UPDATE agents SET|INSERT INTO agent_groups|UPDATE agent_groups SET)/.test(
            sql.trim(),
          )
        )
          rejectReads = true;
        return result;
      },
    };
    const store = new AgentStore(
      wrapped,
      createNodeTransport({ dataDir: '.', secrets }),
      () => 123,
    );
    const created = await store.api.create({
      profile: { name: '  Router  ', host: '  router.test  ', version: 'v2c' },
      secrets: { community: 'private' },
    });
    expect(created).toMatchObject({
      name: 'Router',
      host: 'router.test',
      port: 161,
      transport: 'udp4',
      timeoutMs: 5000,
      retries: 1,
      getBulkNonRepeaters: 0,
      getBulkMaxRepetitions: 20,
      hasCommunity: true,
      hasAuthKey: false,
      hasPrivKey: false,
      createdAt: 123,
      updatedAt: 123,
    });

    rejectReads = false;
    const updated = await store.api.update(created.id, { profile: { name: '  Renamed  ' } });
    expect(updated).toMatchObject({
      id: created.id,
      name: 'Renamed',
      host: 'router.test',
      hasCommunity: true,
      createdAt: 123,
      updatedAt: 123,
    });

    rejectReads = false;
    const group = await store.api.groups.create({ name: '  Core  ', agentIds: [] });
    expect(group).toEqual({
      id: expect.any(String),
      name: 'Core',
      agentIds: [],
      createdAt: 123,
      updatedAt: 123,
    });

    rejectReads = false;
    const updatedGroup = await store.api.groups.update(group.id, { name: '  Edge  ' });
    expect(updatedGroup).toEqual({ ...group, name: 'Edge', updatedAt: 123 });
  });

  it('compensates create DB and partial-secret failures', async () => {
    for (const failure of ['db', 'partial-secret'] as const) {
      const values = new Map<string, string>();
      let writes = 0;
      const secrets: SecretStore = {
        set: async (key, value) => {
          writes += 1;
          if (failure === 'partial-secret' && writes === 2) throw new Error('second secret failed');
          values.set(key, value);
        },
        get: async (key) => values.get(key) ?? null,
        delete: async (key) => void values.delete(key),
        isEncrypted: () => true,
      };
      const db = nodeStorageFactory.open(':memory:');
      schema(db);
      const wrapped: StorageAdapter = {
        ...db,
        exec: db.exec.bind(db),
        get: db.get.bind(db),
        all: db.all.bind(db),
        transaction: db.transaction.bind(db),
        close: db.close.bind(db),
        run: (sql, params) => {
          if (failure === 'db' && sql.startsWith('INSERT INTO agents'))
            throw new Error('db failed');
          return db.run(sql, params);
        },
      };
      const store = new AgentStore(wrapped, createNodeTransport({ dataDir: '.', secrets }));
      await expect(
        store.api.create({
          profile: { name: 'A', host: '127.0.0.1', version: 'v3' },
          v3: { user: 'u', level: 'authPriv', authProtocol: 'sha', privProtocol: 'aes' },
          secrets: { authKey: 'auth-value', privKey: 'priv-value' },
        }),
      ).rejects.toThrow();
      expect(values.size).toBe(0);
      expect(await store.api.list()).toEqual([]);
    }
  });

  it('restores delete secrets after transaction failure and reports rollback-unknown safely', async () => {
    for (const rollbackFails of [false, true]) {
      const values = new Map<string, string>();
      let rejectRestore = false;
      const secrets: SecretStore = {
        set: async (key, value) => {
          if (rejectRestore && rollbackFails) throw new Error('restore failed');
          values.set(key, value);
        },
        get: async (key) => values.get(key) ?? null,
        delete: async (key) => void values.delete(key),
        isEncrypted: () => true,
      };
      const db = nodeStorageFactory.open(':memory:');
      schema(db);
      let failDelete = false;
      const wrapped: StorageAdapter = {
        ...db,
        exec: db.exec.bind(db),
        run: db.run.bind(db),
        get: db.get.bind(db),
        all: db.all.bind(db),
        close: db.close.bind(db),
        transaction: (fn) => {
          if (failDelete) throw new Error('transaction failed');
          return db.transaction(fn);
        },
      };
      const store = new AgentStore(wrapped, createNodeTransport({ dataDir: '.', secrets }));
      const saved = await store.api.create({
        profile: { name: 'A', host: '127.0.0.1', version: 'v2c' },
        secrets: { community: 'old-value' },
      });
      failDelete = true;
      rejectRestore = true;
      const failure = await store.api.delete(saved.id).catch((error: unknown) => error);
      expect(await store.api.get(saved.id)).not.toBeNull();
      if (rollbackFails) {
        expect(failure).toMatchObject({
          message: expect.stringContaining('rollback outcome unknown'),
        });
        expect(JSON.stringify(failure)).not.toContain('old-value');
      } else {
        expect(failure).toMatchObject({ message: 'transaction failed' });
        expect([...values.values()]).toEqual(['old-value']);
      }
    }
  });

  it('reports create rollback-unknown without secret content', async () => {
    const values = new Map<string, string>();
    let rejectDelete = false;
    const secrets: SecretStore = {
      set: async (k, v) => void values.set(k, v),
      get: async (k) => values.get(k) ?? null,
      delete: async (k) => {
        if (rejectDelete) throw new Error('delete failed');
        values.delete(k);
      },
      isEncrypted: () => true,
    };
    const db = nodeStorageFactory.open(':memory:');
    schema(db);
    const wrapped: StorageAdapter = {
      ...db,
      exec: db.exec.bind(db),
      get: db.get.bind(db),
      all: db.all.bind(db),
      transaction: db.transaction.bind(db),
      close: db.close.bind(db),
      run: (sql, params) => {
        if (sql.startsWith('INSERT INTO agents')) {
          rejectDelete = true;
          throw new Error('db failed');
        }
        return db.run(sql, params);
      },
    };
    const store = new AgentStore(wrapped, createNodeTransport({ dataDir: '.', secrets }));
    const failure = await store.api
      .create({
        profile: { name: 'A', host: '127.0.0.1', version: 'v2c' },
        secrets: { community: 'private-value' },
      })
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ message: expect.stringContaining('rollback outcome unknown') });
    expect(JSON.stringify(failure)).not.toContain('private-value');
  });

  it('rechecks dependencies inside the delete transaction after secret I/O', async () => {
    const values = new Map<string, string>();
    const secrets: SecretStore = {
      set: async (k, v) => void values.set(k, v),
      get: async (k) => values.get(k) ?? null,
      delete: async (k) => void values.delete(k),
      isEncrypted: () => true,
    };
    const db = nodeStorageFactory.open(':memory:');
    schema(db);
    let inject = false;
    let agentId = '';
    const wrapped: StorageAdapter = {
      ...db,
      exec: db.exec.bind(db),
      run: db.run.bind(db),
      get: db.get.bind(db),
      all: db.all.bind(db),
      close: db.close.bind(db),
      transaction: (fn) =>
        db.transaction(() => {
          if (inject)
            db.run('INSERT INTO operation_bookmarks (id, agent_id) VALUES (?, ?)', [
              'late',
              agentId,
            ]);
          return fn();
        }),
    };
    const store = new AgentStore(wrapped, createNodeTransport({ dataDir: '.', secrets }));
    const saved = await store.api.create({
      profile: { name: 'A', host: '127.0.0.1', version: 'v2c' },
      secrets: { community: 'old-value' },
    });
    agentId = saved.id;
    inject = true;
    await expect(store.api.delete(saved.id)).rejects.toThrow(/bookmarks \(1\)/);
    expect(await store.api.get(saved.id)).not.toBeNull();
    expect([...values.values()]).toEqual(['old-value']);
    expect(db.all('SELECT * FROM operation_bookmarks')).toEqual([]);
  });

  it('restores the previous credential when the profile row update fails', async () => {
    const values = new Map<string, string>();
    const secrets: SecretStore = {
      set: async (key, value) => void values.set(key, value),
      get: async (key) => values.get(key) ?? null,
      delete: async (key) => void values.delete(key),
      isEncrypted: () => true,
    };
    const db = nodeStorageFactory.open(':memory:');
    schema(db);
    let failUpdate = false;
    const wrapped: StorageAdapter = {
      ...db,
      exec: db.exec.bind(db),
      get: db.get.bind(db),
      all: db.all.bind(db),
      transaction: db.transaction.bind(db),
      close: db.close.bind(db),
      run: (sql, params) => {
        if (failUpdate && sql.startsWith('UPDATE agents SET')) throw new Error('db unavailable');
        return db.run(sql, params);
      },
    };
    const store = new AgentStore(wrapped, createNodeTransport({ dataDir: '.', secrets }));
    const saved = await store.api.create({
      profile: { name: 'A', host: '127.0.0.1', version: 'v2c' },
      secrets: { community: 'old-value' },
    });
    failUpdate = true;
    await expect(
      store.api.update(saved.id, { secrets: { community: 'new-value' } }),
    ).rejects.toThrow('db unavailable');
    expect([...values.values()]).toEqual(['old-value']);
    expect(await store.api.get(saved.id)).toMatchObject({ name: 'A', hasCommunity: true });
  });

  it('reports an explicit uncertain rollback outcome without credential content', async () => {
    const values = new Map<string, string>();
    let rejectOld = false;
    const secrets: SecretStore = {
      set: async (key, value) => {
        if (rejectOld && value === 'old-value') throw new Error('secret backend unavailable');
        values.set(key, value);
      },
      get: async (key) => values.get(key) ?? null,
      delete: async (key) => void values.delete(key),
      isEncrypted: () => true,
    };
    const db = nodeStorageFactory.open(':memory:');
    schema(db);
    let failUpdate = false;
    const wrapped: StorageAdapter = {
      ...db,
      exec: db.exec.bind(db),
      get: db.get.bind(db),
      all: db.all.bind(db),
      transaction: db.transaction.bind(db),
      close: db.close.bind(db),
      run: (sql, params) => {
        if (failUpdate && sql.startsWith('UPDATE agents SET')) throw new Error('db unavailable');
        return db.run(sql, params);
      },
    };
    const store = new AgentStore(wrapped, createNodeTransport({ dataDir: '.', secrets }));
    const saved = await store.api.create({
      profile: { name: 'A', host: '127.0.0.1', version: 'v2c' },
      secrets: { community: 'old-value' },
    });
    failUpdate = true;
    rejectOld = true;
    const failure = await store.api
      .update(saved.id, { secrets: { community: 'new-value' } })
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ message: expect.stringContaining('rollback outcome unknown') });
    expect(JSON.stringify(failure)).not.toContain('old-value');
    expect(JSON.stringify(failure)).not.toContain('new-value');
  });
});
