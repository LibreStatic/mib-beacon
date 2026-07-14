/// <reference path="./net-snmp.d.ts" />
import type { MibModuleEntry } from 'net-snmp';
import { enumValues, formatSyntax } from './format-syntax';
import type {
  MibNodeDetail,
  MibNodeKind,
  MibNodeSummary,
  MibSearchHit,
  ModuleTreeNode,
  ResolvedName,
  OidTranslation,
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
  private textualConventions = new Map<string, MibModuleEntry>();
  private displayHints = new Map<string, string>();

  rebuild(
    modules: Record<string, Record<string, MibModuleEntry>>,
    displayHints: Record<string, string> = {},
  ): void {
    this.root = {
      arc: -1,
      oid: '',
      kind: 'subtree',
      children: new Map(),
      entries: new Map(),
    };
    this.byName = new Map();
    this.byModuleName = new Map();
    this.textualConventions = new Map();
    this.displayHints = new Map(Object.entries(displayHints));

    for (const symbols of Object.values(modules)) {
      for (const [symbol, entry] of Object.entries(symbols)) {
        if (
          entry &&
          typeof entry === 'object' &&
          (entry.MACRO === 'TEXTUAL-CONVENTION' || entry['DISPLAY-HINT'])
        ) {
          this.textualConventions.set(entry.ObjectName ?? symbol, entry);
        }
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
    // The most recently loaded definition wins display, while entries retains
    // every module assignment for diagnostics and module-focused navigation.
    node.entry = entry;
    if (entry.ObjectName) node.label = entry.ObjectName;
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
    const rawIndexes = e?.INDEX?.map(String) ?? [];
    const syntaxMetadata = this.resolveSyntaxMetadata(formatSyntax(e?.SYNTAX));
    const definitions = [...node.entries.entries()].map(([module, entry]) => ({
      module,
      name: entry.ObjectName ?? node.label ?? node.oid,
    }));
    return {
      ...this.summarize(node, e),
      namedPath: e?.NameSpace,
      syntax: formatSyntax(e?.SYNTAX),
      status: e?.STATUS,
      units: e?.UNITS,
      description: e?.DESCRIPTION,
      indexes:
        rawIndexes.length > 0
          ? rawIndexes.map((index) => index.replace(/^IMPLIED\s+/i, ''))
          : undefined,
      impliedIndexes: rawIndexes.some((index) => /^IMPLIED\s+/i.test(index))
        ? rawIndexes
            .filter((index) => /^IMPLIED\s+/i.test(index))
            .map((index) => index.replace(/^IMPLIED\s+/i, ''))
        : undefined,
      augments: e?.AUGMENTS?.map(String),
      textualConventionChain: syntaxMetadata.chain,
      displayHint: syntaxMetadata.displayHint,
      enumValues: enumValues(e?.SYNTAX),
      definitions: definitions.length > 1 ? definitions : undefined,
      warnings:
        definitions.length > 1
          ? [
              `Duplicate OID ${node.oid} is defined by ${definitions.map(({ module }) => module).join(' and ')}`,
            ]
          : undefined,
      objects: e?.OBJECTS?.map(String),
    };
  }

  private resolveSyntaxMetadata(syntax?: string): { chain?: string[]; displayHint?: string } {
    if (!syntax) return {};
    const chain: string[] = [];
    let current = syntax;
    let displayHint: string | undefined;
    const visited = new Set<string>();
    while (true) {
      const name = current.match(/^[A-Za-z][A-Za-z0-9-]*/)?.[0];
      if (!name || visited.has(name)) break;
      const convention = this.textualConventions.get(name);
      if (!convention) break;
      visited.add(name);
      chain.push(name);
      displayHint ??= convention['DISPLAY-HINT'] ?? this.displayHints.get(name);
      current = formatSyntax(convention.SYNTAX) ?? '';
    }
    if (chain.length === 0) return {};
    const primitive = current.match(
      /^(?:OCTET STRING|OBJECT IDENTIFIER|INTEGER|BITS|IpAddress|Counter\d*|Gauge\d*|Unsigned\d*|TimeTicks)/i,
    )?.[0];
    if (primitive) chain.push(primitive);
    return { chain, ...(displayHint ? { displayHint } : {}) };
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

  /** Bidirectional exact/instance translation between numeric and symbolic OIDs. */
  translate(oidOrName: string): OidTranslation | null {
    const value = oidOrName.trim().replace(/^\./, '');
    if (/^[0-9.]+$/.test(value)) {
      const resolved = this.resolve(value);
      return resolved ? { oid: value, name: resolved.name, module: resolved.module } : null;
    }
    const qualified = value.match(
      /^(?:([A-Za-z][A-Za-z0-9-]*)::)?([A-Za-z][A-Za-z0-9-]*)(?:\.(\d+(?:\.\d+)*))?$/,
    );
    if (!qualified) return null;
    const [, moduleName, symbol, suffix] = qualified;
    const node = this.node(symbol!, moduleName);
    if (!node) return null;
    return {
      oid: suffix ? `${node.oid}.${suffix}` : node.oid,
      name: suffix ? `${node.name}.${suffix}` : node.name,
      ...(node.module ? { module: node.module } : {}),
    };
  }

  search(query: string, limit = 30): MibSearchHit[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const hits: { hit: MibSearchHit; score: number }[] = [];
    const isOidQuery = /^[0-9.]+$/.test(q);
    const visit = (node: TrieNode): void => {
      if (node.entry) {
        const match = this.matchSearch(node, node.entry, q, isOidQuery);
        if (match) hits.push(match);
      }
      for (const child of node.children.values()) visit(child);
    };
    visit(this.root);
    return hits
      .sort(
        (left, right) =>
          left.score - right.score ||
          left.hit.name.localeCompare(right.hit.name) ||
          left.hit.oid.localeCompare(right.hit.oid),
      )
      .slice(0, Math.max(0, limit))
      .map(({ hit }) => hit);
  }

  searchModule(moduleName: string, query: string, limit = 30): MibSearchHit[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const hits: { hit: MibSearchHit; score: number }[] = [];
    const isOidQuery = /^\d+(?:\.\d+)*$/.test(q);
    const visit = (node: TrieNode): void => {
      const entry = node.entries.get(moduleName);
      if (entry) {
        const match = this.matchSearch(node, entry, q, isOidQuery);
        if (match) hits.push(match);
      }
      for (const child of node.children.values()) visit(child);
    };
    visit(this.root);
    return hits
      .sort(
        (left, right) =>
          left.score - right.score ||
          left.hit.name.localeCompare(right.hit.name) ||
          left.hit.oid.localeCompare(right.hit.oid),
      )
      .slice(0, Math.max(0, limit))
      .map(({ hit }) => hit);
  }

  private matchSearch(
    node: TrieNode,
    entry: MibModuleEntry,
    query: string,
    isOidQuery: boolean,
  ): { hit: MibSearchHit; score: number } | null {
    if (isOidQuery) {
      if (!node.oid.startsWith(query)) return null;
      return {
        hit: this.hit(node, 'oid', entry, [{ field: 'oid', start: 0, end: query.length }]),
        score: 300 + (node.oid.length - query.length),
      };
    }
    const name = entry.ObjectName ?? node.label ?? String(node.arc);
    const lowerName = name.toLowerCase();
    if (lowerName === query) {
      return {
        hit: this.hit(node, 'name', entry, [{ field: 'name', start: 0, end: name.length }]),
        score: 0,
      };
    }
    if (lowerName.startsWith(query)) {
      return {
        hit: this.hit(node, 'name', entry, [{ field: 'name', start: 0, end: query.length }]),
        score: 100 + (name.length - query.length),
      };
    }
    const containedAt = lowerName.indexOf(query);
    if (containedAt >= 0) {
      return {
        hit: this.hit(node, 'name', entry, [
          { field: 'name', start: containedAt, end: containedAt + query.length },
        ]),
        score: 200 + containedAt,
      };
    }
    const subsequence = subsequencePositions(lowerName, query);
    if (subsequence) {
      return {
        hit: this.hit(node, 'name', entry, positionsToHighlights('name', subsequence)),
        score:
          220 +
          subsequence[0]! * 2 +
          (subsequence.at(-1)! - subsequence[0]! + 1 - query.length) +
          (name.length - query.length),
      };
    }
    const distance = levenshtein(lowerName, query);
    if (distance <= Math.max(2, Math.floor(query.length * 0.35))) {
      return {
        hit: this.hit(node, 'name', entry, [{ field: 'name', start: 0, end: name.length }]),
        score: 250 + distance,
      };
    }
    const description = entry.DESCRIPTION ?? '';
    const descriptionAt = description.toLowerCase().indexOf(query);
    if (descriptionAt >= 0) {
      return {
        hit: this.hit(node, 'description', entry, [
          { field: 'description', start: descriptionAt, end: descriptionAt + query.length },
        ]),
        score: 400 + descriptionAt,
      };
    }
    return null;
  }

  private hit(
    node: TrieNode,
    matched: MibSearchHit['matched'],
    entry = node.entry,
    highlights?: MibSearchHit['highlights'],
  ): MibSearchHit {
    return {
      oid: node.oid,
      name: entry?.ObjectName ?? node.label ?? String(node.arc),
      module: entry?.ModuleName,
      kind: node.kind,
      matched,
      ...(highlights && highlights.length > 0 ? { highlights } : {}),
    };
  }
}

function subsequencePositions(value: string, query: string): number[] | null {
  const positions: number[] = [];
  let offset = 0;
  for (const character of query) {
    const found = value.indexOf(character, offset);
    if (found < 0) return null;
    positions.push(found);
    offset = found + 1;
  }
  return positions;
}

function positionsToHighlights(
  field: 'name',
  positions: number[],
): NonNullable<MibSearchHit['highlights']> {
  const highlights: NonNullable<MibSearchHit['highlights']> = [];
  for (const position of positions) {
    const previous = highlights.at(-1);
    if (previous && previous.end === position) previous.end = position + 1;
    else highlights.push({ field, start: position, end: position + 1 });
  }
  return highlights;
}

function levenshtein(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const current = [leftIndex + 1];
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      current.push(
        Math.min(
          current[rightIndex]! + 1,
          previous[rightIndex + 1]! + 1,
          previous[rightIndex]! + (left[leftIndex] === right[rightIndex] ? 0 : 1),
        ),
      );
    }
    previous = current;
  }
  return previous[right.length]!;
}
