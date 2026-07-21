import { describe, expect, it, vi } from 'vitest';
import type { EngineAPI } from '@mibbeacon/core/client';
import { loadOwnedLiveMibTreeNode } from './live-mib-tree-node';

describe('owned Live MIB tree-node loading', () => {
  it('stops an A tree completion before node detail or B-local commits', async () => {
    let resolveTree!: (value: never[]) => void;
    const node = vi.fn();
    const engine = {
      mibs: { tree: () => new Promise((resolve) => (resolveTree = resolve)), node },
    } as unknown as EngineAPI;
    let owns = true;
    const loading = loadOwnedLiveMibTreeNode(
      engine,
      { oid: '1.3', module: 'OLD', hasChildren: true } as never,
      true,
      () => owns,
    );
    owns = false;
    resolveTree([]);
    await expect(loading).resolves.toBeNull();
    expect(node).not.toHaveBeenCalled();
  });
});
