/// <reference path="./net-snmp.d.ts" />
import snmp from 'net-snmp';
import type { ModuleStore } from 'net-snmp';
import { OidIndex } from './oid-index';
import { BASE_MIBS } from './base-mibs.generated';
import type { ImportResult, ModuleInfo } from './types';

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
  importTexts(files: { name: string; content: string }[]): ImportResult {
    const loaded: string[] = [];
    const errors: ImportResult['errors'] = [];
    for (const file of files) {
      const before = new Set(this.store.getModuleNames(true));
      try {
        this.store.parser.ParseModule(file.name.replace(/\.[^.]*$/, ''), file.content);
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
        if (added.length === 0) {
          errors.push({ name: file.name, message: 'no MIB module definition found in file' });
          continue;
        }
        for (const moduleName of added) {
          try {
            this.store.addTranslationsForModule(moduleName);
          } catch {
            /* translation table is best-effort; the index below is authoritative */
          }
          this.sources.set(moduleName, file.content);
          loaded.push(moduleName);
        }
      } catch (e) {
        errors.push({ name: file.name, message: (e as Error).message ?? String(e) });
      }
    }
    if (loaded.length > 0) this.reindex();
    return { loaded, errors };
  }

  /** Unload a user module by rebuilding the store from the remaining sources. */
  unload(moduleName: string): void {
    if (this.baseModuleNames.has(moduleName)) {
      throw new Error(`${moduleName} is a base module and cannot be unloaded`);
    }
    if (!this.sources.delete(moduleName)) return;
    const remaining = [...this.sources.entries()];
    this.store = snmp.createModuleStore({ baseModules: [] });
    this.loadBaseModules();
    this.sources.clear();
    this.importTexts(remaining.map(([name, content]) => ({ name, content })));
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
