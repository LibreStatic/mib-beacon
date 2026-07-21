import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MibStore } from '@mibbeacon/smi';
import { createNodeTransport, nodeStorageFactory } from '@mibbeacon/transport/node';
import { AsyncMutationQueue } from './async-mutex';
import { runMigrations } from './db/migrate';
import { EventBus } from './events';
import { ResolverService } from './resolver-service';

describe('resolver cache clear serialization', () => {
  it('waits behind resolver mutations on the shared queue', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'resolver-cache-queue-'));
    const transport = createNodeTransport({ dataDir: directory });
    const db = nodeStorageFactory.open(':memory:');
    runMigrations(db);
    const queue = new AsyncMutationQueue();
    const service = new ResolverService(transport, db, new MibStore(), new EventBus(), queue);
    let release!: () => void;
    const occupied = queue.run(() => new Promise<void>((resolve) => (release = resolve)));
    let clearSettled = false;

    const clearing = service.api.cache.clear().then(() => {
      clearSettled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(clearSettled).toBe(false);

    release();
    await occupied;
    await clearing;
    expect(clearSettled).toBe(true);
  });
});
