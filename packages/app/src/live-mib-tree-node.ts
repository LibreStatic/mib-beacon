import type { EngineAPI, MibNodeDetail, MibNodeSummary } from '@mibbeacon/core/client';

export interface LoadedLiveMibTreeNode {
  children?: MibNodeSummary[];
  detail: MibNodeDetail | null;
}

export async function loadOwnedLiveMibTreeNode(
  engine: EngineAPI,
  node: MibNodeSummary,
  loadChildren: boolean,
  owns: () => boolean,
): Promise<LoadedLiveMibTreeNode | null> {
  if (!owns()) return null;
  const children = loadChildren ? await engine.mibs.tree(node.oid) : undefined;
  if (!owns()) return null;
  const detail = await engine.mibs.node(node.oid, node.module);
  if (!owns()) return null;
  return { children, detail };
}
