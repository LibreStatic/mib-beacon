import type { BrowseTreeNode } from '../store';

export interface FlatBrowseTreeRow {
  node: BrowseTreeNode;
  depth: number;
  rootIndex: number;
}

const ROOT_HUES = [210, 265, 165, 35, 330, 190] as const;

export interface TreeDisclosureVisual {
  glyph: '▶' | '▼' | '·';
  tone: 'collapsed' | 'expanded' | 'neutral';
}

export function flattenVisibleTree(
  cache: Record<string, BrowseTreeNode[]>,
  expanded: Record<string, boolean>,
): FlatBrowseTreeRow[] {
  const rows: FlatBrowseTreeRow[] = [];

  const walk = (oid: string, depth: number, rootIndex: number) => {
    const children = cache[oid];
    if (!children) return;

    for (const child of children) {
      rows.push({ node: child, depth, rootIndex });
      if (expanded[child.oid]) walk(child.oid, depth + 1, rootIndex);
    }
  };

  for (const [rootIndex, root] of (cache[''] ?? []).entries()) {
    rows.push({ node: root, depth: 0, rootIndex });
    if (expanded[root.oid]) walk(root.oid, 1, rootIndex);
  }

  return rows;
}

export function getTreeRowBackground(
  scheme: 'light' | 'dark',
  rootIndex: number,
  depth: number,
): string {
  const hue = ROOT_HUES[rootIndex % ROOT_HUES.length]!;
  const saturation = scheme === 'dark' ? 22 : 30;
  const startingLightness = scheme === 'dark' ? 17 : 97;
  const minimumLightness = scheme === 'dark' ? 9 : 88;
  const lightness = Math.max(minimumLightness, startingLightness - depth * 2);

  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

export function getTreeDisclosureVisual(
  hasChildren: boolean,
  expanded: boolean,
): TreeDisclosureVisual {
  if (!hasChildren) return { glyph: '·', tone: 'neutral' };
  return expanded ? { glyph: '▼', tone: 'expanded' } : { glyph: '▶', tone: 'collapsed' };
}
