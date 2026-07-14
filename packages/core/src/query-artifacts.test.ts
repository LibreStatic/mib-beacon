import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeTransport } from '@mibbeacon/transport/node';
import { createEngine } from './engine';

describe('query bookmarks and snapshots', () => {
  it('persists bookmark metadata and private snapshot result files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mibbeacon-query-artifacts-'));
    const transport = createNodeTransport({ dataDir: directory });
    const engine = createEngine(transport, { dbPath: join(directory, 'mibbeacon.db') });

    const bookmark = await engine.ops.bookmarks.create({
      name: 'System walk',
      agentId: 'agent-one',
      oid: '1.3.6.1.2.1.1',
      operation: 'walk',
    });
    expect(await engine.ops.bookmarks.list()).toEqual([bookmark]);

    const snapshot = await engine.ops.snapshots.create({
      name: 'Before change',
      agentName: 'Core switch',
      baseOid: '1.3.6.1.2.1.1',
      results: [
        {
          oid: '1.3.6.1.2.1.1.5.0',
          name: 'sysName.0',
          type: 4,
          typeName: 'OctetString',
          value: 'edge',
          rawValue: 'edge',
          isError: false,
        },
      ],
    });
    await expect(engine.ops.snapshots.get(snapshot.id)).resolves.toMatchObject({
      name: 'Before change',
      results: [{ name: 'sysName.0', rawValue: 'edge' }],
    });
    expect(await transport.files.exists(join(directory, 'snapshots', `${snapshot.id}.json`))).toBe(
      true,
    );

    await engine.ops.bookmarks.delete(bookmark.id);
    await engine.ops.snapshots.delete(snapshot.id);
    expect(await engine.ops.bookmarks.list()).toEqual([]);
    expect(await engine.ops.snapshots.list()).toEqual([]);
    expect(await transport.files.exists(join(directory, 'snapshots', `${snapshot.id}.json`))).toBe(
      false,
    );
  });
});
