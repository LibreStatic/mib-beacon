import { parseCheckMibText } from '@omc/smi';
import { HostScheduler } from './scheduler';
import { validateMibContent } from './sources/validator';

export interface MibImport {
  module: string;
  symbols: string[];
}

export interface ParsedMibDocument {
  modules: string[];
  imports: MibImport[];
}

export interface MibSourceFound {
  status: 'found';
  module: string;
  content: string;
  sourceId: string;
  location: string;
  warnings?: string[];
}

export interface MibSourceMiss {
  status: 'not-found';
  module: string;
  sourceId: string;
  reason?: string;
  httpStatus?: number;
  retryAfterMs?: number;
}

export type MibSourceResult = MibSourceFound | MibSourceMiss;

export interface MibSource {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly enabled: boolean;
  readonly priority: number;
  readonly hosts: string[];
  fetch(module: string, context?: { signal?: AbortSignal }): Promise<MibSourceResult>;
}

export interface CachedMib {
  module: string;
  content: string;
  sourceId: string;
  location: string;
  warnings?: string[];
  storedAt?: number;
}

export interface MibCache {
  get(module: string): Promise<CachedMib | undefined>;
  put(value: CachedMib): Promise<void>;
  delete(module: string): Promise<void>;
  clear(): Promise<void>;
}

export class InMemoryMibCache implements MibCache {
  private readonly entries = new Map<string, CachedMib>();

  async get(module: string): Promise<CachedMib | undefined> {
    return this.entries.get(module);
  }

  async put(value: CachedMib): Promise<void> {
    this.entries.set(value.module, { ...value, storedAt: value.storedAt ?? Date.now() });
  }

  async delete(module: string): Promise<void> {
    this.entries.delete(module);
  }

  async clear(): Promise<void> {
    this.entries.clear();
  }
}

/** Tokenizes the intentionally small, regular parts of an SMI/PIB module. */
export function parseMibDocument(content: string): ParsedMibDocument {
  const modules = [
    ...content.matchAll(/\b([A-Za-z][A-Za-z0-9-]*)\s+(?:PIB-)?DEFINITIONS\s*::=\s*BEGIN\b/gi),
  ].flatMap((match) => (match[1] ? [match[1]] : []));
  const clause = /\bIMPORTS\b([\s\S]*?);/i.exec(content)?.[1];
  if (!clause) return { modules, imports: [] };

  const tokens = clause.replace(/--[^\r\n]*/g, '').match(/[A-Za-z][A-Za-z0-9-]*|,/g) ?? [];
  const imports: MibImport[] = [];
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
      symbols = [];
      index += 1;
    }
  }
  return { modules, imports };
}

/** Post-order traversal gives a deterministic dependency-before-parent load order. */
export function dependencyLeafFirst(roots: string[], graph: ReadonlyMap<string, readonly string[]>): string[] {
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const result: string[] = [];
  const visit = (module: string): void => {
    if (visited.has(module) || visiting.has(module)) return;
    visiting.add(module);
    for (const dependency of graph.get(module) ?? []) visit(dependency);
    visiting.delete(module);
    visited.add(module);
    result.push(module);
  };
  for (const root of roots) visit(root);
  return result;
}

export type ResolverProgress =
  | { type: 'queued'; module: string; requestedBy?: string; depth: number }
  | { type: 'cache-hit'; module: string }
  | { type: 'source-attempt'; module: string; sourceId: string; requestedBy: string[] }
  | {
      type: 'source-found';
      module: string;
      sourceId: string;
      location: string;
      requestedBy: string[];
      warnings?: string[];
    }
  | { type: 'source-error'; module: string; sourceId: string; message: string; requestedBy: string[] }
  | { type: 'source-miss'; module: string; sourceId: string; requestedBy: string[]; reason?: string; httpStatus?: number }
  | { type: 'source-cooldown'; sourceId: string; httpStatus: 403 | 429; until: number }
  | { type: 'progress'; completed: number; total: number }
  | { type: 'failed'; module: string; reason: string }
  | { type: 'done'; status: ResolverStatus; resolved: number; failed: number };

export type ResolverStatus = 'resolved' | 'partial' | 'failed' | 'cancelled';

export interface ResolvedDocument extends CachedMib {
  fromCache: boolean;
}

export interface ResolutionFailure {
  module: string;
  requestedBy: string[];
  reason: string;
}

export interface ResolverResult {
  status: ResolverStatus;
  documents: ResolvedDocument[];
  failed: ResolutionFailure[];
  graph: Record<string, MibImport[]>;
}

export interface ResolveRequest {
  missingImports: MibImport[];
  onProgress?: (event: ResolverProgress) => void;
  signal?: AbortSignal;
  availableModules?: Iterable<string>;
}

interface QueueItem {
  module: string;
  depth: number;
  requestedBy?: string;
}

export class MibResolver {
  private readonly sources: MibSource[];
  private readonly cache: MibCache;
  private readonly maxDepth: number;
  private readonly maxModules: number;
  private readonly scheduler: HostScheduler;
  private readonly cooldowns = new Map<string, number>();
  private readonly now: () => number;

  constructor(options: {
    sources: MibSource[];
    cache: MibCache;
    maxDepth?: number;
    maxModules?: number;
    scheduler?: HostScheduler;
    now?: () => number;
  }) {
    this.sources = options.sources
      .filter((source) => source.enabled)
      .sort((left, right) => left.priority - right.priority);
    this.cache = options.cache;
    this.maxDepth = options.maxDepth ?? 25;
    this.maxModules = options.maxModules ?? 200;
    this.scheduler = options.scheduler ?? new HostScheduler({ maxConcurrent: 3, maxPerHost: 2 });
    this.now = options.now ?? Date.now;
  }

  async resolve(request: ResolveRequest): Promise<ResolverResult> {
    const available = new Set(request.availableModules ?? []);
    const roots = [...new Set(request.missingImports.map((item) => item.module))];
    const candidates: QueueItem[] = roots
      .filter((module) => !available.has(module))
      .map((module) => ({ module, depth: 0 }));
    const queue = candidates.slice(0, this.maxModules);
    const queued = new Set(queue.map((item) => item.module));
    const graph = new Map<string, MibImport[]>();
    const documents = new Map<string, ResolvedDocument>();
    const failed = new Map<string, ResolutionFailure>();
    const requestedBy = new Map<string, Set<string>>();
    let admitted = queue.length;
    let completed = 0;

    for (const item of queue) request.onProgress?.({ type: 'queued', module: item.module, depth: 0 });
    for (const item of candidates.slice(this.maxModules)) {
      const reason = `maximum module count ${this.maxModules} exceeded`;
      failed.set(item.module, { module: item.module, requestedBy: [], reason });
      request.onProgress?.({ type: 'failed', module: item.module, reason });
      completed += 1;
    }

    while (queue.length > 0 && !request.signal?.aborted) {
      const depth = queue[0]!.depth;
      const batch: QueueItem[] = [];
      while (queue[0]?.depth === depth) batch.push(queue.shift()!);
      const outcomes = await Promise.all(
        batch.map(async (item) => {
          if (item.depth > this.maxDepth) {
            return { item, reason: `maximum dependency depth ${this.maxDepth} exceeded` } as const;
          }
          const fetched = await this.fetch(item.module, requestedBy, request.onProgress, request.signal);
          if (!fetched.document) return { item, reason: fetched.reason } as const;
          return { item, document: fetched.document, imports: parseMibDocument(fetched.document.content) } as const;
        }),
      );

      for (const outcome of outcomes) {
        completed += 1;
        if ('reason' in outcome) {
          const reason = outcome.reason ?? 'not found';
          if (reason !== 'operation aborted') {
            this.addFailure(failed, outcome.item.module, requestedBy, reason);
            request.onProgress?.({ type: 'failed', module: outcome.item.module, reason });
          }
          request.onProgress?.({ type: 'progress', completed, total: Math.max(admitted, completed) });
          continue;
        }
        if (request.signal?.aborted) continue;
        documents.set(outcome.item.module, outcome.document);
        graph.set(outcome.item.module, outcome.imports.imports);
        for (const dependency of outcome.imports.imports) {
          const parents = requestedBy.get(dependency.module) ?? new Set<string>();
          parents.add(outcome.item.module);
          requestedBy.set(dependency.module, parents);
          if (available.has(dependency.module) || queued.has(dependency.module)) continue;
          if (admitted >= this.maxModules) {
            const reason = `maximum module count ${this.maxModules} exceeded`;
            this.addFailure(failed, dependency.module, requestedBy, reason);
            request.onProgress?.({ type: 'failed', module: dependency.module, reason });
            continue;
          }
          admitted += 1;
          queued.add(dependency.module);
          queue.push({ module: dependency.module, depth: outcome.item.depth + 1, requestedBy: outcome.item.module });
          request.onProgress?.({
            type: 'queued',
            module: dependency.module,
            requestedBy: outcome.item.module,
            depth: outcome.item.depth + 1,
          });
        }
        request.onProgress?.({ type: 'progress', completed, total: admitted });
      }
    }

    const orderingGraph = new Map(
      [...graph].map(([module, imports]) => [module, imports.map((item) => item.module)] as const),
    );
    const order = dependencyLeafFirst(roots, orderingGraph);
    const orderedDocuments = order.flatMap((module) => {
      const document = documents.get(module);
      return document ? [document] : [];
    });
    const failures = [...failed.values()].map((failure) => ({
      ...failure,
      requestedBy: [...(requestedBy.get(failure.module) ?? failure.requestedBy)],
    }));
    const status: ResolverStatus = request.signal?.aborted
      ? 'cancelled'
      : failures.length === 0
        ? 'resolved'
        : documents.size > 0
          ? 'partial'
          : 'failed';
    request.onProgress?.({ type: 'done', status, resolved: documents.size, failed: failures.length });
    return { status, documents: orderedDocuments, failed: failures, graph: Object.fromEntries(graph) };
  }

  private addFailure(
    failures: Map<string, ResolutionFailure>,
    module: string,
    requestedBy: Map<string, Set<string>>,
    reason: string,
  ): void {
    failures.set(module, { module, requestedBy: [...(requestedBy.get(module) ?? [])], reason });
  }

  private async fetch(
    module: string,
    requestedBy: Map<string, Set<string>>,
    onProgress?: (event: ResolverProgress) => void,
    signal?: AbortSignal,
  ): Promise<{ document?: ResolvedDocument; reason: string }> {
    if (signal?.aborted) return { reason: 'operation aborted' };
    const cached = await this.cache.get(module);
    if (signal?.aborted) return { reason: 'operation aborted' };
    if (cached) {
      const invalid = this.validateDocument(module, cached.content);
      if (!invalid) {
        onProgress?.({ type: 'cache-hit', module });
        return { document: { ...cached, fromCache: true }, reason: '' };
      }
      await this.cache.delete(module);
    }

    let lastReason = 'not found';
    for (const source of this.sources) {
      if (signal?.aborted) return { reason: 'operation aborted' };
      const cooldownUntil = this.cooldowns.get(source.id) ?? 0;
      if (cooldownUntil > this.now()) continue;
      onProgress?.({
        type: 'source-attempt',
        module,
        sourceId: source.id,
        requestedBy: [...(requestedBy.get(module) ?? [])],
      });
      const host = source.hosts[0] ?? source.id;
      let result: MibSourceResult | undefined;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          result = await this.scheduler.run(host, async () => {
            if ((this.cooldowns.get(source.id) ?? 0) > this.now()) {
              return { status: 'not-found', module, sourceId: source.id, reason: 'source cooldown active' };
            }
            return source.fetch(module, { signal });
          }, signal);
          break;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (signal?.aborted) return { reason: 'operation aborted' };
          lastReason = message;
          onProgress?.({
            type: 'source-error', module, sourceId: source.id, message,
            requestedBy: [...(requestedBy.get(module) ?? [])],
          });
        }
      }
      if (!result) continue;
      if (result.status === 'not-found') {
        lastReason = result.reason ?? lastReason;
        onProgress?.({
          type: 'source-miss',
          module,
          sourceId: source.id,
          requestedBy: [...(requestedBy.get(module) ?? [])],
          reason: result.reason,
          httpStatus: result.httpStatus,
        });
        if (result.httpStatus === 403 || result.httpStatus === 429) {
          const until = this.now() + (result.retryAfterMs ?? 30_000);
          this.cooldowns.set(source.id, until);
          onProgress?.({ type: 'source-cooldown', sourceId: source.id, httpStatus: result.httpStatus, until });
        }
        continue;
      }
      if (signal?.aborted) return { reason: 'operation aborted' };
      const invalid = this.validateDocument(module, result.content);
      if (invalid) {
        lastReason = invalid;
        onProgress?.({
          type: 'source-error', module, sourceId: source.id, message: invalid,
          requestedBy: [...(requestedBy.get(module) ?? [])],
        });
        continue;
      }
      const value: CachedMib = {
        module,
        content: result.content,
        sourceId: result.sourceId,
        location: result.location,
        warnings: result.warnings,
      };
      if (signal?.aborted) return { reason: 'operation aborted' };
      await this.cache.put(value);
      if (signal?.aborted) {
        await this.cache.delete(module);
        return { reason: 'operation aborted' };
      }
      onProgress?.({
        type: 'source-found',
        module,
        sourceId: source.id,
        location: result.location,
        requestedBy: [...(requestedBy.get(module) ?? [])],
        ...(result.warnings ? { warnings: result.warnings } : {}),
      });
      return { document: { ...value, fromCache: false }, reason: '' };
    }
    return { reason: lastReason };
  }

  private validateDocument(module: string, content: string): string | undefined {
    const validation = validateMibContent(module, content);
    if (!validation.ok) return validation.message;
    if (validation.moduleName.toLowerCase() !== module.toLowerCase()) {
      return `Requested ${module} but content defines ${validation.moduleName}`;
    }
    const parsed = parseCheckMibText(content);
    return parsed.ok ? undefined : parsed.message;
  }
}
