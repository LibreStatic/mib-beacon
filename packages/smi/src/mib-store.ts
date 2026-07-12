/// <reference path="./net-snmp.d.ts" />
import snmp from 'net-snmp';
import type { ModuleStore } from 'net-snmp';
import { OidIndex } from './oid-index';
import { BASE_MIBS } from './base-mibs.generated';
import type {
  ImportResult,
  MibFilesInspection,
  MibTextFile,
  ModuleDependency,
  ModuleInfo,
  ModuleTreeNode,
  ModuleView,
} from './types';

interface ParsedImport {
  module: string;
  symbols: string[];
}

/** Blank comments and quoted strings while preserving offsets/newlines. */
function smiStructure(content: string): string {
  // RegExp match.index and String.slice use UTF-16 code-unit offsets. Splitting
  // by code point (`[...content]`) would shrink astral characters and corrupt
  // every later module boundary.
  const chars = content.split('');
  let inString = false;
  let inComment = false;
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index]!;
    const next = chars[index + 1];
    if (inComment) {
      if (char === '\n' || char === '\r') inComment = false;
      else chars[index] = ' ';
      continue;
    }
    if (inString) {
      if (char === '"' && next === '"') {
        chars[index] = chars[index + 1] = ' ';
        index += 1;
      } else if (char === '"') {
        chars[index] = ' ';
        inString = false;
      } else if (char !== '\n' && char !== '\r') chars[index] = ' ';
      continue;
    }
    if (char === '-' && next === '-') {
      chars[index] = chars[index + 1] = ' ';
      index += 1;
      inComment = true;
    } else if (char === '"') {
      chars[index] = ' ';
      inString = true;
    }
  }
  return chars.join('');
}

/** Read the simple token grammar of an SMI IMPORTS clause without invoking net-snmp. */
function parseImports(content: string): ParsedImport[] {
  content = smiStructure(content);
  const imports: ParsedImport[] = [];
  for (const clause of content.matchAll(/\bIMPORTS\b([\s\S]*?);/gi)) {
    const tokens = clause[1]?.replace(/--[^\r\n]*/g, '').match(/[A-Za-z][A-Za-z0-9-]*|,/g);
    if (!tokens) continue;
    let symbols: string[] = [];
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index]!;
      if (token === ',') continue;
      if (token.toUpperCase() !== 'FROM') {
        symbols.push(token);
        continue;
      }
      const module = tokens[index + 1];
      if (module && module !== ',') {
        imports.push({ module, symbols });
        index += 1;
      }
      symbols = [];
    }
  }
  return imports;
}

function definedModules(content: string): Set<string> {
  return new Set(
    [...smiStructure(content).matchAll(/\b([A-Za-z][A-Za-z0-9-]*)\s+DEFINITIONS\s*::=\s*BEGIN\b/gi)].flatMap(
      (match) => (match[1] ? [match[1]] : []),
    ),
  );
}

function splitModuleTexts(content: string): { module: string; content: string }[] {
  const matches = [...smiStructure(content).matchAll(/\b([A-Za-z][A-Za-z0-9-]*)\s+DEFINITIONS\s*::=\s*BEGIN\b/gi)];
  return matches.map((match, index) => ({
    module: match[1]!,
    content: content.slice(match.index!, matches[index + 1]?.index ?? content.length),
  }));
}

/** Dependency-first order; strongly-connected members remain adjacent and are
 * all registered before the single Serialize pass resolves their references. */
function orderModuleTexts(
  documents: { module: string; content: string }[],
): { module: string; content: string }[] {
  const byModule = new Map(documents.map((document) => [document.module, document]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const ordered: { module: string; content: string }[] = [];
  const visit = (module: string): void => {
    if (visited.has(module) || visiting.has(module)) return;
    visiting.add(module);
    const document = byModule.get(module);
    for (const dependency of parseImports(document?.content ?? '')) {
      const isOidDependency = dependency.symbols.some((symbol) =>
        new RegExp(`::=\\s*\\{\\s*${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(
          document?.content ?? '',
        ),
      );
      // net-snmp resolves OIDs while compiling each module. Type references
      // can remain symbolic, so hard OID providers determine SCC order.
      if (isOidDependency && byModule.has(dependency.module)) visit(dependency.module);
    }
    visiting.delete(module);
    visited.add(module);
    if (document) ordered.push(document);
  };
  for (const document of documents) visit(document.module);
  return ordered;
}

/**
 * Wraps node-net-snmp's ModuleStore with what it lacks:
 *  - parsing MIBs from raw text (any platform — no fs)
 *  - unload (rebuild from retained sources)
 *  - an OID tree index for browsing/search/name-resolution
 *
 * Parsing from text mirrors ModuleStore.loadFromFile, which is just
 * fs.readFileSync + parser.ParseModule (verified against 3.26.3). We create the
 * store with NO base modules and load the base set from the bundled BASE_MIBS
 * corpus via ParseModule, because net-snmp's own loadBaseModules() uses
 * fs.readFileSync — which does not exist in React Native.
 */
export class MibStore {
  private store: ModuleStore;
  private baseModuleNames: Set<string>;
  /** Retained raw sources of user-loaded MIBs, keyed by module name. */
  private sources = new Map<string, string>();
  readonly index = new OidIndex();

  constructor() {
    this.store = snmp.createModuleStore({ baseModules: [] });
    this.loadBaseModules();
    this.baseModuleNames = new Set(this.store.getModuleNames(true));
    this.reindex();
  }

  private loadBaseModules(): void {
    for (const mib of BASE_MIBS) {
      try {
        this.store.parser.ParseModule(mib.name, mib.content);
      } catch {
        /* a base module failing to parse is non-fatal; others still load */
      }
    }
    this.store.parser.Serialize();
    for (const moduleName of this.store.getModuleNames(true)) {
      try {
        this.store.addTranslationsForModule(moduleName);
      } catch {
        /* best-effort translations; the index is authoritative */
      }
    }
  }

  /**
   * Parse one or more MIB texts. Returns per-file results; a file that defines
   * no new module is reported as an error. Multi-module files are supported
   * (the parser splits on MODULE … DEFINITIONS internally).
   */
  importTexts(files: MibTextFile[]): ImportResult {
    const loaded: string[] = [];
    const errors: ImportResult['errors'] = [];
    if (files.length === 0) return { loaded, errors };
    const available = new Set(this.store.getModuleNames(true));
    const localModules = new Set(files.flatMap((file) => [...definedModules(file.content)]));
    for (const file of files) {
      const missingImports = parseImports(file.content).filter(
        (item) => !available.has(item.module) && !localModules.has(item.module),
      );
      if (missingImports.length > 0) {
        const dependencyList = missingImports
          .map(({ module, symbols }) => `${module} (${symbols.join(', ')})`)
          .join('; ');
        errors.push({
          name: file.name,
          code: 'MIB_MISSING_IMPORTS',
          missingImports,
          message: `Import dependencies first: ${dependencyList}`,
        });
        continue;
      }
    }
    // A batch is staged as one unit. Parsing only the files without direct
    // missing imports would strand their intra-batch dependants and leak a
    // partial catalog before the resolver can retry the exact batch.
    if (errors.length > 0) return { loaded, errors };
    const withoutDefinitions = files.filter((file) => definedModules(file.content).size === 0);
    if (withoutDefinitions.length > 0) {
      return {
        loaded,
        errors: withoutDefinitions.map((file) => ({
          name: file.name,
          code: 'MIB_PARSE_FAILED',
          message: 'no MIB module definition found in file',
        })),
      };
    }
    const malformed = files.filter((file) =>
      splitModuleTexts(file.content).some(
        (document) => !/\bEND\s*$/i.test(smiStructure(document.content).trim()),
      ),
    );
    if (malformed.length > 0) {
      return {
        loaded,
        errors: malformed.map((file) => ({
          name: file.name,
          code: 'MIB_PARSE_FAILED',
          message: 'MIB module definition has no terminating END statement',
        })),
      };
    }

    const definitions = new Map<string, string[]>();
    for (const file of files) {
      for (const { module } of splitModuleTexts(file.content)) {
        const owners = definitions.get(module) ?? [];
        owners.push(file.name);
        definitions.set(module, owners);
      }
    }
    const duplicates = [...definitions].filter(([, owners]) => owners.length > 1);
    if (duplicates.length > 0) {
      return {
        loaded,
        errors: duplicates.map(([module, owners]) => ({
          name: owners.join(', '),
          code: 'MIB_PARSE_FAILED',
          message: `duplicate module definition ${module}: ${owners.join(', ')}`,
        })),
      };
    }

    const before = new Set(this.store.getModuleNames(true));
    try {
      const documents = orderModuleTexts(
        files.flatMap((file) => splitModuleTexts(file.content)),
      );
      if (documents.length === 0) {
        for (const file of files) {
          this.store.parser.ParseModule(file.name.replace(/\.[^.]*$/, ''), file.content);
        }
      } else {
        for (const document of documents) {
          this.store.parser.ParseModule(document.module, document.content);
        }
      }
      this.store.parser.Serialize();
      const addedRaw = this.store.getModuleNames(true).filter((m) => !before.has(m));
        // The parser registers a phantom empty module (even named "undefined")
        // for unparseable input — prune those instead of reporting them loaded.
      const added = addedRaw.filter((m) => {
          const symbols = this.store.getModule(m);
          const real = m !== 'undefined' && symbols && Object.keys(symbols).length > 0;
          if (!real) delete this.store.parser.Modules[m];
          return real;
      });
      if (added.length === 0) throw new Error('no MIB module definition found in file');
      for (const moduleName of added) {
          try {
            this.store.addTranslationsForModule(moduleName);
          } catch {
            /* translation table is best-effort; the index below is authoritative */
          }
        const owner = files.find((file) => definedModules(file.content).has(moduleName));
        if (owner) this.sources.set(moduleName, owner.content);
        loaded.push(moduleName);
      }
    } catch (e) {
        // ParseModule/Serialize mutate node-net-snmp's parser before throwing.
        // Rebuild from known-good retained sources so a failed import cannot
        // leak an empty/partial module into the catalog.
        this.rebuildFromSources();
      errors.push({
          name: files.map((file) => file.name).join(', '),
          code: 'MIB_PARSE_FAILED',
          message: (e as Error).message ?? String(e),
      });
    }
    if (loaded.length > 0) this.reindex();
    return { loaded, errors };
  }

  /** Analyze a prospective batch using only its text and current metadata. */
  inspectFiles(files: MibTextFile[]): MibFilesInspection {
    const loaded = new Map(this.listModules().map((module) => [module.name, module]));
    const definitions = new Map<string, string[]>();
    for (const file of files) {
      for (const { module } of splitModuleTexts(file.content)) {
        const owners = definitions.get(module) ?? [];
        owners.push(file.name);
        definitions.set(module, owners);
      }
    }
    const batchModules = new Set(definitions.keys());
    const duplicateDefinitions = [...definitions]
      .filter(([, owners]) => owners.length > 1)
      .map(([module, owners]) => ({ module, files: owners }));
    const external = new Map<string, { symbols: Set<string>; requestedBy: Set<string> }>();
    const inspectedFiles = files.map((file) => {
      const modules = [...definedModules(file.content)];
      const imports = parseImports(file.content).map((item) => {
        const isExternal = !loaded.has(item.module) && !batchModules.has(item.module);
        if (isExternal) {
          const aggregate = external.get(item.module) ?? {
            symbols: new Set<string>(),
            requestedBy: new Set<string>(),
          };
          item.symbols.forEach((symbol) => aggregate.symbols.add(symbol));
          aggregate.requestedBy.add(file.name);
          external.set(item.module, aggregate);
        }
        return { ...item, external: isExternal };
      });
      const collisions = modules.flatMap((module) => {
        const result: {
          module: string;
          kind: 'base' | 'loaded-user' | 'batch-duplicate';
          replacementGroup?: string[];
        }[] = [];
        const existing = loaded.get(module);
        if (existing) {
          const source = this.sources.get(module);
          const replacementGroup = source
            ? [...this.sources].filter(([, content]) => content === source).map(([name]) => name)
            : undefined;
          result.push({
            module,
            kind: existing.isBase ? 'base' : 'loaded-user',
            ...(replacementGroup ? { replacementGroup } : {}),
          });
        }
        if ((definitions.get(module)?.length ?? 0) > 1) {
          result.push({ module, kind: 'batch-duplicate' });
        }
        return result;
      });
      const errors = modules.length === 0 ? ['No MIB module definition found'] : [];
      return {
        name: file.name,
        ...(file.relativePath ? { relativePath: file.relativePath } : {}),
        modules,
        imports,
        warnings: [],
        errors,
        collisions,
      };
    });
    return {
      files: inspectedFiles,
      duplicateDefinitions,
      externalMissingImports: [...external].map(([module, value]) => ({
        module,
        symbols: [...value.symbols],
        requestedBy: [...value.requestedBy],
      })),
      replacementGroups: [...new Set(this.sources.values())].map((source) => ({
        modules: [...this.sources]
          .filter(([, content]) => content === source)
          .map(([module]) => module),
      })),
    };
  }

  /** Replace loaded user modules by building an isolated candidate catalog. */
  replaceTexts(files: MibTextFile[], replaceModules: string[]): ImportResult {
    const requested = new Set(replaceModules);
    for (const moduleName of [...requested]) {
      if (this.baseModuleNames.has(moduleName)) {
        throw new Error(`${moduleName} is a base module and cannot be replaced`);
      }
      if (!this.sources.has(moduleName)) {
        throw new Error(`${moduleName} is not a loaded user module`);
      }
      const source = this.sources.get(moduleName);
      for (const [peer, peerSource] of this.sources) {
        if (peerSource === source) requested.add(peer);
      }
    }
    const incoming = new Set(files.flatMap((file) => [...definedModules(file.content)]));
    for (const moduleName of requested) {
      if (!incoming.has(moduleName)) {
        return {
          loaded: [],
          errors: [{
            name: files.map((file) => file.name).join(', '),
            code: 'MIB_PARSE_FAILED',
            message: `replacement batch does not define ${moduleName}`,
          }],
        };
      }
    }
    const retained = [...this.sources.entries()]
      .filter(([moduleName]) => !requested.has(moduleName))
      .filter((entry, index, entries) => entries.findIndex((other) => other[1] === entry[1]) === index)
      .map(([name, content]) => ({ name, content }));
    const candidate = new MibStore();
    const result = candidate.importTexts([...retained, ...files]);
    if (result.errors.length > 0) return { loaded: [], errors: result.errors };
    this.store = candidate.store;
    this.baseModuleNames = candidate.baseModuleNames;
    this.sources = candidate.sources;
    this.reindex();
    return { loaded: [...incoming], errors: [] };
  }

  /** Build an isolated, equivalent catalog for transactional operations. */
  fork(): MibStore {
    const candidate = new MibStore();
    const uniqueSources = [...new Set(this.sources.values())].map((content, index) => ({
      name: `catalog-${index}.mib`,
      content,
    }));
    const result = candidate.importTexts(uniqueSources);
    if (result.errors.length > 0) {
      throw new Error(`failed to stage MIB catalog: ${result.errors[0]!.message}`);
    }
    return candidate;
  }

  /** Atomically swap parser/index state after external persistence succeeds. */
  adopt(candidate: MibStore): void {
    this.store = candidate.store;
    this.baseModuleNames = candidate.baseModuleNames;
    this.sources = new Map(candidate.sources);
    this.reindex();
  }

  userSources(): { name: string; content: string }[] {
    return [...this.sources].map(([name, content]) => ({ name, content }));
  }

  /** Unique source documents, named by a stable owning module for persistence. */
  userSourceDocuments(): { name: string; content: string; modules: string[] }[] {
    return [...new Set(this.sources.values())].map((content) => {
      const modules = [...this.sources]
        .filter(([, source]) => source === content)
        .map(([module]) => module)
        .sort();
      return { name: modules[0]!, content, modules };
    });
  }

  /** User-module names sharing the same retained source document. */
  replacementGroup(moduleName: string): string[] | null {
    const source = this.sources.get(moduleName);
    if (!source) return null;
    return [...this.sources]
      .filter(([, content]) => content === source)
      .map(([module]) => module)
      .sort();
  }

  /** Unload a user module by rebuilding the store from the remaining sources. */
  unload(moduleName: string): void {
    if (this.baseModuleNames.has(moduleName)) {
      throw new Error(`${moduleName} is a base module and cannot be unloaded`);
    }
    const source = this.sources.get(moduleName);
    if (!source) return;
    for (const [peer, peerSource] of this.sources) {
      if (peerSource === source) this.sources.delete(peer);
    }
    this.rebuildFromSources();
  }

  private rebuildFromSources(): void {
    const remaining = [...this.sources.entries()];
    this.store = snmp.createModuleStore({ baseModules: [] });
    this.loadBaseModules();
    this.baseModuleNames = new Set(this.store.getModuleNames(true));
    this.sources.clear();
    const seenContent = new Set<string>();
    const files = remaining
      .filter(([, content]) => {
        if (seenContent.has(content)) return false;
        seenContent.add(content);
        return true;
      })
      .map(([name, content]) => ({ name, content }));
    const restored = this.importTexts(files);
    if (restored.errors.length > 0) {
      throw new Error(`failed to restore MIB catalog: ${restored.errors[0]!.message}`);
    }
    this.reindex();
  }

  listModules(): ModuleInfo[] {
    return this.store
      .getModuleNames(true)
      .map((name) => ({
        name,
        objectCount: Object.values(this.store.getModule(name) ?? {}).filter(
          (e) => e && typeof e === 'object' && e.OID,
        ).length,
        isBase: this.baseModuleNames.has(name),
      }))
      .sort((a, b) => Number(a.isBase) - Number(b.isBase) || a.name.localeCompare(b.name));
  }

  module(moduleName: string): ModuleView | null {
    const module = this.listModules().find((item) => item.name === moduleName);
    const raw = this.store.getModule(moduleName) as
      (Record<string, unknown> & { IMPORTS?: Record<string, string[]> }) | undefined;
    if (!module || !raw) return null;
    const loaded = new Set(this.store.getModuleNames(true));
    const dependencies: ModuleDependency[] = Object.entries(raw.IMPORTS ?? {})
      .map(([name, symbols]) => ({ name, symbols: [...symbols], loaded: loaded.has(name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { module, dependencies };
  }

  moduleChildren(moduleName: string, oid?: string): ModuleTreeNode[] {
    const view = this.module(moduleName);
    if (!view) return [];
    return this.index.moduleChildren(moduleName, view.dependencies, oid);
  }

  /** Raw source of a user-loaded module (for persistence). */
  getSource(moduleName: string): string | undefined {
    return this.sources.get(moduleName);
  }

  userModuleNames(): string[] {
    return [...this.sources.keys()];
  }

  private reindex(): void {
    this.index.rebuild(this.store.getModules(true));
  }
}
