import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNodeTransport, nodeStorageFactory } from '@mibbeacon/transport/node';
import type { FileStore, StorageAdapter } from '@mibbeacon/transport';
import { runMigrations } from './migrate';
import { PersistentMibCache } from './resolver-store';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'mib-cache-clear-'));
  const db = nodeStorageFactory.open(':memory:');
  runMigrations(db);
  const files = createNodeTransport({ dataDir: directory }).files;
  const cache = new PersistentMibCache(db, files);
  await cache.put({
    module: 'IF-MIB',
    content: 'IF-MIB DEFINITIONS ::= BEGIN END',
    sourceId: 'test',
    location: 'memory',
    warnings: ['confirmed'],
    storedAt: 42,
  });
  return { db, files, cache };
}

describe('PersistentMibCache.clear atomicity', () => {
  it('restores both metadata and files when directory removal takes effect and then throws', async () => {
    const { db, files } = await fixture();
    const wrapped: FileStore = {
      ...files,
      remove: async (path) => {
        await files.remove(path);
        throw new Error('remove response lost');
      },
    };
    const cache = new PersistentMibCache(db, wrapped);

    await expect(cache.clear()).rejects.toThrow('remove response lost');
    await expect(cache.get('IF-MIB')).resolves.toMatchObject({
      module: 'IF-MIB',
      warnings: ['confirmed'],
    });
  });

  it('restores both metadata and files when the database delete takes effect and then throws', async () => {
    const { db, files } = await fixture();
    const wrapped: StorageAdapter = {
      exec: db.exec.bind(db),
      get: db.get.bind(db),
      all: db.all.bind(db),
      transaction: db.transaction.bind(db),
      close: db.close.bind(db),
      run(sql, params) {
        const result = db.run(sql, params);
        if (sql === 'DELETE FROM resolver_cache') throw new Error('database response lost');
        return result;
      },
    };
    const cache = new PersistentMibCache(wrapped, files);

    await expect(cache.clear()).rejects.toThrow('database response lost');
    await expect(cache.get('IF-MIB')).resolves.toMatchObject({ module: 'IF-MIB' });
  });

  it('reports rollback-unknown when compensation cannot restore a removed file', async () => {
    const { db, files } = await fixture();
    let removed = false;
    const wrapped: FileStore = {
      ...files,
      remove: async (path) => {
        removed = true;
        await files.remove(path);
        throw new Error('remove response lost');
      },
      writeText: async (path, content) => {
        if (removed) throw new Error('restore failed');
        await files.writeText(path, content);
      },
    };
    const cache = new PersistentMibCache(db, wrapped);

    await expect(cache.clear()).rejects.toThrow(/rollback outcome unknown.*restore failed/i);
  });
});
