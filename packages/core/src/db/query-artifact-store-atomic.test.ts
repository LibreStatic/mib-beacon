import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StorageAdapter, Transport } from '@mibbeacon/transport';
import { createNodeTransport, nodeStorageFactory } from '@mibbeacon/transport/node';
import { QueryArtifactStore } from './query-artifact-store';

const snapshotInput = {
  name: 'Before change',
  agentName: 'Core switch',
  baseOid: '1.3.6.1',
  results: [],
};

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'mibbeacon-query-artifact-atomic-'));
  const baseTransport = createNodeTransport({ dataDir: directory });
  const transport = {
    ...baseTransport,
    crypto: {
      ...baseTransport.crypto,
      randomBytes: (size: number) => new Uint8Array(size),
    },
  } satisfies Transport;
  const db = nodeStorageFactory.open(':memory:');
  db.exec(`
    CREATE TABLE operation_bookmarks (
      id TEXT PRIMARY KEY, name TEXT, agent_id TEXT, oid TEXT, operation TEXT,
      created_at INTEGER, updated_at INTEGER
    );
    CREATE TABLE walk_snapshots (
      id TEXT PRIMARY KEY, name TEXT, agent_name TEXT, base_oid TEXT, file_path TEXT,
      result_count INTEGER, created_at INTEGER
    );
  `);
  return { directory, transport, db };
}

function dbFailingSnapshotDelete(db: StorageAdapter): StorageAdapter {
  return {
    ...db,
    exec: db.exec.bind(db),
    get: db.get.bind(db),
    all: db.all.bind(db),
    transaction: db.transaction.bind(db),
    close: db.close.bind(db),
    run: (sql, params) => {
      if (/DELETE FROM walk_snapshots/.test(sql)) throw new Error('database delete failed');
      return db.run(sql, params);
    },
  };
}

describe('QueryArtifactStore snapshot atomicity', () => {
  it('returns constructed bookmark metadata without a post-write list read', async () => {
    const { transport, db } = await fixture();
    const failingReadDb: StorageAdapter = {
      ...db,
      exec: db.exec.bind(db),
      get: db.get.bind(db),
      transaction: db.transaction.bind(db),
      close: db.close.bind(db),
      run: db.run.bind(db),
      all: (sql, params) => {
        if (/SELECT \* FROM operation_bookmarks/.test(sql))
          throw new Error('post-write read failed');
        return db.all(sql, params);
      },
    };
    const store = new QueryArtifactStore(failingReadDb, transport, () => 7);

    expect(
      store.createBookmark({
        name: '  Normalized  ',
        agentId: 'agent',
        oid: '  1.3.6.1  ',
        operation: 'walk',
      }),
    ).toMatchObject({ name: 'Normalized', oid: '1.3.6.1', createdAt: 7, updatedAt: 7 });
  });

  it('returns constructed snapshot metadata without a post-write list read', async () => {
    const { transport, db } = await fixture();
    const failingReadDb: StorageAdapter = {
      ...db,
      exec: db.exec.bind(db),
      get: db.get.bind(db),
      transaction: db.transaction.bind(db),
      close: db.close.bind(db),
      run: db.run.bind(db),
      all: (sql, params) => {
        if (/SELECT \* FROM walk_snapshots/.test(sql)) throw new Error('post-write read failed');
        return db.all(sql, params);
      },
    };
    const store = new QueryArtifactStore(failingReadDb, transport, () => 7);

    await expect(store.createSnapshot(snapshotInput)).resolves.toMatchObject({
      name: 'Before change',
      createdAt: 7,
      resultCount: 0,
    });
  });

  it('removes the new result file when snapshot metadata insertion fails', async () => {
    const { directory, transport, db } = await fixture();
    const failingDb: StorageAdapter = {
      ...db,
      exec: db.exec.bind(db),
      get: db.get.bind(db),
      all: db.all.bind(db),
      transaction: db.transaction.bind(db),
      close: db.close.bind(db),
      run: (sql, params) => {
        if (/INSERT INTO walk_snapshots/.test(sql)) throw new Error('database insert failed');
        return db.run(sql, params);
      },
    };
    const store = new QueryArtifactStore(failingDb, transport, () => 1);

    await expect(store.createSnapshot(snapshotInput)).rejects.toThrow('database insert failed');

    expect(store.listSnapshots()).toEqual([]);
    const expectedFile = join(directory, 'snapshots', 'snapshot-000000000000000000000000.json');
    await expect(transport.files.exists(expectedFile)).resolves.toBe(false);
  });

  it('removes both metadata and file when snapshot insertion takes effect and then throws', async () => {
    const { directory, transport, db } = await fixture();
    const effectThenThrowDb: StorageAdapter = {
      ...db,
      exec: db.exec.bind(db),
      get: db.get.bind(db),
      all: db.all.bind(db),
      transaction: db.transaction.bind(db),
      close: db.close.bind(db),
      run: (sql, params) => {
        const result = db.run(sql, params);
        if (/INSERT INTO walk_snapshots/.test(sql)) throw new Error('insert completion unknown');
        return result;
      },
    };
    const store = new QueryArtifactStore(effectThenThrowDb, transport, () => 1);

    await expect(store.createSnapshot(snapshotInput)).rejects.toThrow('insert completion unknown');

    expect(store.listSnapshots()).toEqual([]);
    await expect(
      transport.files.exists(
        join(directory, 'snapshots', 'snapshot-000000000000000000000000.json'),
      ),
    ).resolves.toBe(false);
  });

  it('reports an uncertain rollback when a failed create cannot remove its file', async () => {
    const { transport, db } = await fixture();
    const failingDb: StorageAdapter = {
      ...db,
      exec: db.exec.bind(db),
      get: db.get.bind(db),
      all: db.all.bind(db),
      transaction: db.transaction.bind(db),
      close: db.close.bind(db),
      run: (sql, params) => {
        if (/INSERT INTO walk_snapshots/.test(sql)) throw new Error('database insert failed');
        return db.run(sql, params);
      },
    };
    const failingTransport = {
      ...transport,
      files: {
        ...transport.files,
        remove: async () => {
          throw new Error('file cleanup failed');
        },
      },
    } satisfies Transport;
    const store = new QueryArtifactStore(failingDb, failingTransport, () => 1);

    await expect(store.createSnapshot(snapshotInput)).rejects.toThrow(
      /Snapshot create rollback outcome unknown/,
    );
  });

  it('compensates when file creation takes effect and then throws', async () => {
    const { directory, transport, db } = await fixture();
    const effectThenThrow = {
      ...transport,
      files: {
        ...transport.files,
        writeText: async (path: string, content: string) => {
          await transport.files.writeText(path, content);
          throw new Error('write completion unknown');
        },
      },
    } satisfies Transport;
    const store = new QueryArtifactStore(db, effectThenThrow, () => 1);

    await expect(store.createSnapshot(snapshotInput)).rejects.toThrow('write completion unknown');
    expect(store.listSnapshots()).toEqual([]);
    await expect(
      transport.files.exists(
        join(directory, 'snapshots', 'snapshot-000000000000000000000000.json'),
      ),
    ).resolves.toBe(false);
  });

  it('keeps snapshot metadata visible when file deletion fails', async () => {
    const { transport, db } = await fixture();
    const store = new QueryArtifactStore(db, transport, () => 1);
    const snapshot = await store.createSnapshot(snapshotInput);
    const failingTransport = {
      ...transport,
      files: {
        ...transport.files,
        remove: async () => {
          throw new Error('file delete failed');
        },
      },
    } satisfies Transport;
    const failingStore = new QueryArtifactStore(db, failingTransport, () => 1);

    await expect(failingStore.deleteSnapshot(snapshot.id)).rejects.toThrow('file delete failed');
    expect(failingStore.listSnapshots()).toEqual([snapshot]);
    await expect(failingStore.getSnapshot(snapshot.id)).resolves.toMatchObject({ id: snapshot.id });
  });

  it('restores the visible file when removal takes effect and then throws', async () => {
    const { transport, db } = await fixture();
    const store = new QueryArtifactStore(db, transport, () => 1);
    const saved = await store.createSnapshot(snapshotInput);
    const effectThenThrow = {
      ...transport,
      files: {
        ...transport.files,
        remove: async (path: string) => {
          await transport.files.remove(path);
          throw new Error('remove completion unknown');
        },
      },
    } satisfies Transport;
    const failingStore = new QueryArtifactStore(db, effectThenThrow, () => 1);

    await expect(failingStore.deleteSnapshot(saved.id)).rejects.toThrow(
      'remove completion unknown',
    );
    expect(failingStore.listSnapshots()).toEqual([saved]);
    await expect(failingStore.getSnapshot(saved.id)).resolves.toMatchObject({ id: saved.id });
  });

  it('restores a deleted result file when metadata deletion fails', async () => {
    const { transport, db } = await fixture();
    const store = new QueryArtifactStore(db, transport, () => 1);
    const snapshot = await store.createSnapshot(snapshotInput);
    const failingStore = new QueryArtifactStore(dbFailingSnapshotDelete(db), transport, () => 1);

    await expect(failingStore.deleteSnapshot(snapshot.id)).rejects.toThrow(
      'database delete failed',
    );
    expect(failingStore.listSnapshots()).toEqual([snapshot]);
    await expect(failingStore.getSnapshot(snapshot.id)).resolves.toMatchObject({ id: snapshot.id });
  });

  it('does not restore an orphan file when metadata deletion takes effect and then throws', async () => {
    const { transport, db } = await fixture();
    const store = new QueryArtifactStore(db, transport, () => 1);
    const snapshot = await store.createSnapshot(snapshotInput);
    const effectThenThrowDb: StorageAdapter = {
      ...db,
      exec: db.exec.bind(db),
      get: db.get.bind(db),
      all: db.all.bind(db),
      transaction: db.transaction.bind(db),
      close: db.close.bind(db),
      run: (sql, params) => {
        const result = db.run(sql, params);
        if (/DELETE FROM walk_snapshots/.test(sql)) throw new Error('delete completion unknown');
        return result;
      },
    };
    const failingStore = new QueryArtifactStore(effectThenThrowDb, transport, () => 1);

    await expect(failingStore.deleteSnapshot(snapshot.id)).rejects.toThrow(
      'delete completion unknown',
    );
    expect(failingStore.listSnapshots()).toEqual([]);
    await expect(
      transport.files.exists(join(transport.files.dataDir(), 'snapshots', `${snapshot.id}.json`)),
    ).resolves.toBe(false);
  });

  it('reports an uncertain rollback when metadata failure cannot restore the file', async () => {
    const { transport, db } = await fixture();
    const store = new QueryArtifactStore(db, transport, () => 1);
    const snapshot = await store.createSnapshot(snapshotInput);
    let writes = 0;
    const failingTransport = {
      ...transport,
      files: {
        ...transport.files,
        writeText: async (path: string, content: string) => {
          writes += 1;
          if (writes > 0) throw new Error('file restore failed');
          await transport.files.writeText(path, content);
        },
      },
    } satisfies Transport;
    const failingStore = new QueryArtifactStore(
      dbFailingSnapshotDelete(db),
      failingTransport,
      () => 1,
    );

    await expect(failingStore.deleteSnapshot(snapshot.id)).rejects.toThrow(
      /Snapshot delete rollback outcome unknown/,
    );
  });
});
