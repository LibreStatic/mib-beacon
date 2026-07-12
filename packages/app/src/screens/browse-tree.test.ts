import { describe, expect, it } from 'vitest';
import type { BrowseTreeNode } from '../store';
import { flattenVisibleTree, getTreeDisclosureVisual, getTreeRowBackground } from './browse-tree';

function node(oid: string, name: string, hasChildren = false): BrowseTreeNode {
  return {
    oid,
    name,
    kind: hasChildren ? 'subtree' : 'scalar',
    hasChildren,
    childCount: hasChildren ? 1 : 0,
  };
}

describe('flattenVisibleTree', () => {
  const firstRoot = node('1', 'iso', true);
  const secondRoot = node('2', 'joint-iso-itu-t', true);
  const child = node('1.3', 'org', true);
  const grandchild = node('1.3.6', 'dod');

  const cache = {
    '': [firstRoot, secondRoot],
    '1': [child],
    '1.3': [grandchild],
    '2': [node('2.5', 'example')],
  };

  it('keeps descendants associated with their top-level root', () => {
    const rows = flattenVisibleTree(cache, { '1': true, '1.3': true, '2': true });

    expect(
      rows.map(({ node: rowNode, depth, rootIndex }) => ({
        oid: rowNode.oid,
        depth,
        rootIndex,
      })),
    ).toEqual([
      { oid: '1', depth: 0, rootIndex: 0 },
      { oid: '1.3', depth: 1, rootIndex: 0 },
      { oid: '1.3.6', depth: 2, rootIndex: 0 },
      { oid: '2', depth: 0, rootIndex: 1 },
      { oid: '2.5', depth: 1, rootIndex: 1 },
    ]);
  });

  it('omits descendants of collapsed roots', () => {
    const rows = flattenVisibleTree(cache, {});

    expect(rows.map(({ node: rowNode }) => rowNode.oid)).toEqual(['1', '2']);
  });
});

describe('getTreeRowBackground', () => {
  it('assigns different subtle hues to adjacent roots', () => {
    expect(getTreeRowBackground('dark', 0, 0)).toBe('hsl(210, 22%, 17%)');
    expect(getTreeRowBackground('dark', 1, 0)).toBe('hsl(265, 22%, 17%)');
  });

  it('darkens descendant levels in both themes', () => {
    expect(getTreeRowBackground('dark', 0, 2)).toBe('hsl(210, 22%, 13%)');
    expect(getTreeRowBackground('light', 0, 2)).toBe('hsl(210, 30%, 93%)');
  });

  it('cycles root hues and caps darkening for deeply nested rows', () => {
    expect(getTreeRowBackground('dark', 6, 0)).toBe(getTreeRowBackground('dark', 0, 0));
    expect(getTreeRowBackground('dark', 0, 99)).toBe('hsl(210, 22%, 9%)');
    expect(getTreeRowBackground('light', 0, 99)).toBe('hsl(210, 30%, 88%)');
  });
});

describe('getTreeDisclosureVisual', () => {
  it('uses distinct, prominent indicators for collapsed and expanded branches', () => {
    expect(getTreeDisclosureVisual(true, false)).toEqual({ glyph: '▶', tone: 'collapsed' });
    expect(getTreeDisclosureVisual(true, true)).toEqual({ glyph: '▼', tone: 'expanded' });
  });

  it('keeps leaf indicators neutral', () => {
    expect(getTreeDisclosureVisual(false, false)).toEqual({ glyph: '·', tone: 'neutral' });
  });
});
