/// <reference path="./net-snmp.d.ts" />
import type { MibModuleEntry } from 'net-snmp';
import { formatSyntax } from './format-syntax';
import type {
  MibNodeDetail,
  MibNodeKind,
  MibNodeSummary,
  MibSearchHit,
  ModuleTreeNode,
  ResolvedName,
} from './types';

interface TrieNode {
  arc: number;
  oid: string;
  /** Symbol name (from a definition or an ancestor's NameSpace path). */
  label?: string;
  entry?: MibModuleEntry;
  /** Every definition at this OID, retained by module for focused views. */
  entries: Map<string, MibModuleEntry>;
  kind: MibNodeKind;
  children: Map<number, TrieNode>;
}

/**
 * OID tree built from every loaded module's parsed entries. Ancestor arcs with
 * no definition of their own are labeled from descendants' NameSpace paths
 * (every entry carries its full named path), so the tree reads as
 * iso.org.dod.internet… even where no symbol is defined.
 */
export class OidIndex {
  private root: TrieNode = {
    arc: -1,
    oid: '',
    kind: 'subtree',
    children: new Map(),
    entries: new Map(),
  };
  private byName = new Map<string, TrieNode>();
  private byModuleName = new Map<string, TrieNode>();

  rebuild(modules: Record<string, Record<string, MibModuleEntry>>): void {
    this.root = {
      arc: -1,
      oid: '',
      kind: 'subtree',
      children: new Map(),
      entries: new Map(),
    };
    this.byName = new Map();
    this.byModuleName = new Map();

    for (const symbols of Object.values(modules)) {
      for (const entry of Object.values(symbols)) {
        if (!entry || typeof entry !== 'object' || !entry.OID) continue;
        this.insert(entry);
      }
    }
    this.classify(this.root, null);
  }

  private insert(entry: MibModuleEntry): void {
    const arcs = entry.OID!.split('.').map(Number);
    if (arcs.some(Number.isNaN)) return;
    const pathLabels = entry.NameSpace?.split('.');
    let node = this.root;
    for (let i = 0; i < arcs.length; i++) {
      const arc = arcs[i]!;
      let child = node.children.get(arc);
      if (!child) {
        child = {
          arc,
          oid: node === this.root ? String(arc) : `${node.oid}.${arc}`,
          kind: 'subtree',
          children: new Map(),
          entries: new Map(),
        };
        node.children.set(arc, child);
      }
      // Label ancestors from this entry's named path when they lack one.
      if (pathLabels && pathLabels.length === arcs.length && !child.label) {
        child.label = pathLabels[i];
      }
      node = child;
    }
    // Prefer a real definition over a previously synthesized node.
    if (!node.entry) {
      node.entry = entry;
      if (entry.ObjectName) node.label = entry.ObjectName;
    }
    if (entry.ModuleName) node.entries.set(entry.ModuleName, entry);
    if (entry.ObjectName && !this.byName.has(entry.ObjectName)) {
      this.byName.set(entry.ObjectName, node);
    }
    if (entry.ObjectName && entry.ModuleName) {
      this.byModuleName.set(`${entry.ModuleName}:${entry.ObjectName}`, node);
    }
  }

  /** Derive node kinds; needs parent context (columns live under entries). */
  private classify(node: TrieNode, parent: TrieNode | null): void {
    const e = node.entry;
    if (e) {
      const syntax = formatSyntax(e.SYNTAX);
      if (e.MACRO === 'MODULE-IDENTITY') node.kind = 'module-identity';
      else if (e.MACRO === 'NOTIFICATION-TYPE' || e.MACRO === 'TRAP-TYPE')
        node.kind = 'notification';
      else if (e.MACRO === 'OBJECT-TYPE') {
        if (syntax?.startsWith('SEQUENCE OF')) node.kind = 'table';
        else if (e.INDEX || e.AUGMENTS) node.kind = 'entry';
        else if (parent?.kind === 'entry') node.kind = 'column';
        else node.kind = 'scalar';
      } else node.kind = 'subtree';
    } else {
      node.kind = node.children.size > 0 ? 'subtree' : 'unknown';
    }
    for (const child of node.children.values()) this.classify(child, node);
  }

  private find(oid: string): TrieNode | null {
    if (!oid) return this.root;
    let node = this.root;
    for (const part of oid.split('.')) {
      const next = node.children.get(Number(part));
      if (!next) return null;
      node = next;
    }
    return node;
  }

  private summarize(node: TrieNode, entry = node.entry): MibNodeSummary {
    return {
      oid: node.oid,
      name: entry?.ObjectName ?? node.label ?? String(node.arc),
      module: entry?.ModuleName,
      kind: node.kind,
      access: entry?.['MAX-ACCESS'] ?? entry?.ACCESS,
      hasChildren: node.children.size > 0,
      childCount: node.children.size,
    };
  }

  /** Children of an OID (or the tree roots when oid is empty/undefined). */
  children(oid?: string): MibNodeSummary[] {
    const node = this.find(oid ?? '');
    if (!node) return [];
    return [...node.children.values()].sort((a, b) => a.arc - b.arc).map((c) => this.summarize(c));
  }

  /** A sparse tree containing one module, its imported symbols, and connector ancestors. */
  moduleChildren(
    moduleName: string,
    dependencies: { name: string; symbols: string[] }[],
    oid?: string,
  ): ModuleTreeNode[] {
    const included = new Set<string>();
    const roles = new Map<string, { role: ModuleTreeNode['role']; owner?: string }>();
    const includePath = (node: TrieNode, role: ModuleTreeNode['role'], owner: string) => {
      const arcs = node.oid.split('.');
      let prefix = '';
      for (const arc of arcs) {
        prefix = prefix ? `${prefix}.${arc}` : arc;
        included.add(prefix);
        if (!roles.has(prefix)) roles.set(prefix, { role: 'parent' });
      }
      const existing = roles.get(node.oid)?.role;
      if (role === 'module' || existing === undefined || existing === 'parent') {
        roles.set(node.oid, { role, owner });
      }
    };

    const visit = (node: TrieNode) => {
      if (node.entries.has(moduleName)) includePath(node, 'module', moduleName);
      for (const child of node.children.values()) visit(child);
    };
    visit(this.root);

    for (const dependency of dependencies) {
      for (const symbol of dependency.symbols) {
        const node = this.byModuleName.get(`${dependency.name}:${symbol}`);
        if (node) includePath(node, 'dependency', dependency.name);
      }
    }

    const parent = this.find(oid ?? '');
    if (!parent) return [];
    return [...parent.children.values()]
      .filter((node) => included.has(node.oid))
      .sort((a, b) => a.arc - b.arc)
      .map((node) => {
        const assignment = roles.get(node.oid) ?? { role: 'parent' as const };
        const entry = assignment.owner ? node.entries.get(assignment.owner) : node.entry;
        const childCount = [...node.children.values()].filter((child) =>
          included.has(child.oid),
        ).length;
        return {
          ...this.summarize(node, entry),
          hasChildren: childCount > 0,
          childCount,
          role: assignment.role,
        };
      });
  }

  /** Full detail for a numeric OID or a symbol name. */
  node(oidOrName: string, moduleName?: string): MibNodeDetail | null {
    const node = /^[0-9.]+$/.test(oidOrName)
      ? this.find(oidOrName)
      : moduleName
        ? (this.byModuleName.get(`${moduleName}:${oidOrName}`) ?? null)
        : (this.byName.get(oidOrName) ?? null);
    if (!node) return null;
    const e = (moduleName ? node.entries.get(moduleName) : undefined) ?? node.entry;
    return {
      ...this.summarize(node, e),
      namedPath: e?.NameSpace,
      syntax: formatSyntax(e?.SYNTAX),
      status: e?.STATUS,
      description: e?.DESCRIPTION,
      indexes: e?.INDEX?.map(String),
      objects: e?.OBJECTS?.map(String),
    };
  }

  /** Longest-prefix resolution of (instance) OIDs to definition names. */
  resolve(oid: string): ResolvedName | null {
    let node = this.root;
    let best: TrieNode | null = null;
    let bestDepth = 0;
    const parts = oid.split('.').map(Number);
    for (let i = 0; i < parts.length; i++) {
      const next = node.children.get(parts[i]!);
      if (!next) break;
      node = next;
      if (node.label) {
        best = node;
        bestDepth = i + 1;
      }
    }
    if (!best) return null;
    const suffix = parts.slice(bestDepth).join('.');
    return {
      name: suffix ? `${best.label}.${suffix}` : best.label!,
      module: best.entry?.ModuleName,
      definitionOid: best.oid,
    };
  }

  search(query: string, limit = 30): MibSearchHit[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const hits: MibSearchHit[] = [];
    const isOidQuery = /^[0-9.]+$/.test(q);
    const visit = (node: TrieNode): boolean => {
      if (hits.length >= limit) return false;
      if (isOidQuery) {
        if (node.oid.startsWith(q) && node.entry) {
          hits.push(this.hit(node, 'oid'));
        }
      } else if (node.label) {
        if (node.label.toLowerCase().includes(q)) hits.push(this.hit(node, 'name'));
        else if (node.entry?.DESCRIPTION?.toLowerCase().includes(q)) {
          hits.push(this.hit(node, 'description'));
        }
      }
      for (const child of node.children.values()) if (!visit(child)) return false;
      return true;
    };
    visit(this.root);
    // exact/prefix name matches first
    return hits.sort((a, b) => {
      const rank = (h: MibSearchHit) =>
        h.name.toLowerCase() === q
          ? 0
          : h.name.toLowerCase().startsWith(q)
            ? 1
            : h.matched === 'name'
              ? 2
              : 3;
      return rank(a) - rank(b);
    });
  }

  searchModule(moduleName: string, query: string, limit = 30): MibSearchHit[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const hits: MibSearchHit[] = [];
    const isOidQuery = /^\d+(?:\.\d+)*$/.test(q);
    const visit = (node: TrieNode): boolean => {
      if (hits.length >= limit) return false;
      const entry = node.entries.get(moduleName);
      if (entry) {
        const name = entry.ObjectName ?? node.label ?? String(node.arc);
        if (isOidQuery && node.oid.startsWith(q)) hits.push(this.hit(node, 'oid', entry));
        else if (!isOidQuery && name.toLowerCase().includes(q)) {
          hits.push(this.hit(node, 'name', entry));
        } else if (!isOidQuery && entry.DESCRIPTION?.toLowerCase().includes(q)) {
          hits.push(this.hit(node, 'description', entry));
        }
      }
      for (const child of node.children.values()) if (!visit(child)) return false;
      return true;
    };
    visit(this.root);
    return hits.sort((a, b) => {
      const rank = (hit: MibSearchHit) =>
        hit.name.toLowerCase() === q ? 0 : hit.name.toLowerCase().startsWith(q) ? 1 : 2;
      return rank(a) - rank(b);
    });
  }

  private hit(node: TrieNode, matched: MibSearchHit['matched'], entry = node.entry): MibSearchHit {
    return {
      oid: node.oid,
      name: entry?.ObjectName ?? node.label ?? String(node.arc),
      module: entry?.ModuleName,
      kind: node.kind,
      matched,
    };
  }
}
