import { describe, expect, it } from 'vitest';
import {
  InMemoryMibCache,
  MibResolver,
  dependencyLeafFirst,
  parseMibDocument,
  type MibSource,
  type ResolverProgress,
} from './resolver';

const mib = (name: string, imports = '') => `${name} DEFINITIONS ::= BEGIN\n${imports}\nresolverTestRoot OBJECT IDENTIFIER ::= { iso 999 }\nEND`;
const importFrom = (symbols: string, module: string) => `IMPORTS ${symbols} FROM ${module};`;

class MapSource implements MibSource {
  readonly id = 'map';
  readonly name = 'Map';
  readonly kind = 'memory' as const;
  readonly enabled = true;
  readonly priority = 1;
  readonly hosts = ['memory'];
  calls: string[] = [];

  constructor(private readonly modules: Record<string, string>) {}

  async fetch(module: string) {
    this.calls.push(module);
    const content = this.modules[module];
    return content
      ? { status: 'found' as const, module, content, sourceId: this.id, location: `memory:${module}` }
      : { status: 'not-found' as const, module, sourceId: this.id };
  }
}

describe('parseMibDocument', () => {
  it('returns the module and exact imported symbols', () => {
    const parsed = parseMibDocument(mib('ROOT-MIB', `IMPORTS\n  ifIndex, ifDescr FROM IF-MIB\n  SnmpAdminString FROM SNMP-FRAMEWORK-MIB;`));
    expect(parsed).toEqual({
      modules: ['ROOT-MIB'],
      imports: [
        { module: 'IF-MIB', symbols: ['ifIndex', 'ifDescr'] },
        { module: 'SNMP-FRAMEWORK-MIB', symbols: ['SnmpAdminString'] },
      ],
    });
  });
});

describe('dependencyLeafFirst', () => {
  it('orders dependencies before parents and tolerates cycles', () => {
    const graph = new Map([
      ['A', ['B', 'C']],
      ['B', ['D']],
      ['C', ['A']],
      ['D', []],
    ]);
    const order = dependencyLeafFirst(['A'], graph);
    expect(order.indexOf('D')).toBeLessThan(order.indexOf('B'));
    expect(order.indexOf('B')).toBeLessThan(order.indexOf('A'));
    expect(new Set(order)).toEqual(new Set(['A', 'B', 'C', 'D']));
  });
});

describe('MibResolver', () => {
  it('resolves a recursive graph breadth-first and returns leaf-first documents', async () => {
    const source = new MapSource({
      'A-MIB': mib('A-MIB', importFrom('b', 'B-MIB')),
      'B-MIB': mib('B-MIB', importFrom('c', 'C-MIB')),
      'C-MIB': mib('C-MIB'),
    });
    const events: ResolverProgress[] = [];
    const result = await new MibResolver({ sources: [source], cache: new InMemoryMibCache() }).resolve({
      missingImports: [{ module: 'A-MIB', symbols: ['a'] }],
      onProgress: (event) => events.push(event),
    });

    expect(source.calls).toEqual(['A-MIB', 'B-MIB', 'C-MIB']);
    expect(result.status).toBe('resolved');
    expect(result.documents.map((item) => item.module)).toEqual(['C-MIB', 'B-MIB', 'A-MIB']);
    expect(result.graph).toEqual({
      'A-MIB': [{ module: 'B-MIB', symbols: ['b'] }],
      'B-MIB': [{ module: 'C-MIB', symbols: ['c'] }],
      'C-MIB': [],
    });
    expect(events.at(-1)?.type).toBe('done');
  });

  it('continues to the next source when a source throws', async () => {
    const broken: MibSource = {
      id: 'broken', name: 'Broken', kind: 'memory', enabled: true, priority: 0, hosts: ['broken'],
      async fetch() { throw new Error('connection reset'); },
    };
    const fallback = new MapSource({ 'A-MIB': mib('A-MIB') });
    const events: ResolverProgress[] = [];
    const result = await new MibResolver({ sources: [broken, fallback], cache: new InMemoryMibCache() }).resolve({
      missingImports: [{ module: 'A-MIB', symbols: [] }],
      onProgress: (event) => events.push(event),
    });
    expect(result.status).toBe('resolved');
    expect(events).toContainEqual({
      type: 'source-error',
      module: 'A-MIB',
      sourceId: 'broken',
      message: 'connection reset',
      requestedBy: [],
    });
  });

  it('uses the explicitly selected source for the root module only', async () => {
    const selected = new MapSource({ 'A-MIB': mib('A-MIB', importFrom('b', 'B-MIB')) });
    (selected as { id: string }).id = 'selected';
    const fallback = new MapSource({ 'A-MIB': mib('A-MIB'), 'B-MIB': mib('B-MIB') });
    (fallback as { id: string }).id = 'fallback';

    const result = await new MibResolver({
      sources: [fallback, selected],
      cache: new InMemoryMibCache(),
    }).resolve({
      missingImports: [{ module: 'A-MIB', symbols: [] }],
      preferredSourceId: 'selected',
    });

    expect(result.status).toBe('resolved');
    expect(selected.calls).toEqual(['A-MIB']);
    expect(fallback.calls).toEqual(['B-MIB']);
  });

  it('records but does not fetch dependencies already available in the catalog', async () => {
    const source = new MapSource({
      'A-MIB': mib('A-MIB', importFrom('OBJECT-TYPE', 'SNMPv2-SMI')),
    });
    const result = await new MibResolver({ sources: [source], cache: new InMemoryMibCache() }).resolve({
      missingImports: [{ module: 'A-MIB', symbols: [] }],
      availableModules: ['SNMPv2-SMI'],
    });
    expect(result.status).toBe('resolved');
    expect(source.calls).toEqual(['A-MIB']);
    expect(result.graph['A-MIB']).toEqual([{ module: 'SNMPv2-SMI', symbols: ['OBJECT-TYPE'] }]);
  });

  it('uses cache before external sources', async () => {
    const cache = new InMemoryMibCache();
    await cache.put({ module: 'A-MIB', content: mib('A-MIB'), sourceId: 'old', location: 'cache' });
    const source = new MapSource({ 'A-MIB': mib('A-MIB') });
    const result = await new MibResolver({ sources: [source], cache }).resolve({
      missingImports: [{ module: 'A-MIB', symbols: [] }],
    });
    expect(result.status).toBe('resolved');
    expect(source.calls).toEqual([]);
    expect(result.documents[0]?.fromCache).toBe(true);
  });

  it('stops without fetching when already cancelled', async () => {
    const source = new MapSource({ 'A-MIB': mib('A-MIB') });
    const controller = new AbortController();
    controller.abort();
    const result = await new MibResolver({ sources: [source], cache: new InMemoryMibCache() }).resolve({
      missingImports: [{ module: 'A-MIB', symbols: [] }],
      signal: controller.signal,
    });
    expect(result.status).toBe('cancelled');
    expect(source.calls).toEqual([]);
  });

  it('reports every parent that requested a shared missing module', async () => {
    const source = new MapSource({
      'A-MIB': mib('A-MIB', `IMPORTS b FROM B-MIB c FROM C-MIB;`),
      'C-MIB': mib('C-MIB', importFrom('b', 'B-MIB')),
    });
    const result = await new MibResolver({ sources: [source], cache: new InMemoryMibCache() }).resolve({
      missingImports: [{ module: 'A-MIB', symbols: [] }],
    });
    expect(result.failed).toContainEqual({ module: 'B-MIB', requestedBy: ['A-MIB', 'C-MIB'], reason: 'not found' });
  });

  it('reports partial resolution without losing the exact graph', async () => {
    const source = new MapSource({
      'A-MIB': mib('A-MIB', `IMPORTS b FROM B-MIB c FROM C-MIB;`),
      'B-MIB': mib('B-MIB'),
    });
    const result = await new MibResolver({ sources: [source], cache: new InMemoryMibCache() }).resolve({
      missingImports: [{ module: 'A-MIB', symbols: ['a'] }],
    });
    expect(result.status).toBe('partial');
    expect(result.failed).toEqual([{ module: 'C-MIB', requestedBy: ['A-MIB'], reason: 'not found' }]);
    expect(result.graph['A-MIB']).toEqual([
      { module: 'B-MIB', symbols: ['b'] },
      { module: 'C-MIB', symbols: ['c'] },
    ]);
  });

  it('applies the module cap to initial roots as well as recursive dependencies', async () => {
    const source = new MapSource({ 'A-MIB': mib('A-MIB'), 'B-MIB': mib('B-MIB'), 'C-MIB': mib('C-MIB') });
    const result = await new MibResolver({ sources: [source], cache: new InMemoryMibCache(), maxModules: 2 }).resolve({
      missingImports: [
        { module: 'A-MIB', symbols: [] }, { module: 'B-MIB', symbols: [] }, { module: 'C-MIB', symbols: [] },
      ],
    });
    expect(source.calls).toEqual(['A-MIB', 'B-MIB']);
    expect(result.failed).toContainEqual({ module: 'C-MIB', requestedBy: [], reason: 'maximum module count 2 exceeded' });
  });

  it('enforces depth 25 and a configurable module cap', async () => {
    const modules: Record<string, string> = {};
    for (let index = 0; index < 28; index += 1) {
      modules[`M${index}-MIB`] = mib(
        `M${index}-MIB`,
        index < 27 ? importFrom('next', `M${index + 1}-MIB`) : '',
      );
    }
    const depthResult = await new MibResolver({ sources: [new MapSource(modules)], cache: new InMemoryMibCache() }).resolve({
      missingImports: [{ module: 'M0-MIB', symbols: [] }],
    });
    expect(depthResult.failed.some((item) => item.reason === 'maximum dependency depth 25 exceeded')).toBe(true);

    const capResult = await new MibResolver({
      sources: [new MapSource(modules)],
      cache: new InMemoryMibCache(),
      maxModules: 2,
    }).resolve({ missingImports: [{ module: 'M0-MIB', symbols: [] }] });
    expect(capResult.failed.some((item) => item.reason === 'maximum module count 2 exceeded')).toBe(true);
  });
});

describe('HostScheduler', () => {
  it('limits work to three overall and two per host', async () => {
    const { HostScheduler } = await import('./scheduler');
    const scheduler = new HostScheduler({ maxConcurrent: 3, maxPerHost: 2 });
    let active = 0;
    let maxActive = 0;
    const hostActive = new Map<string, number>();
    let maxA = 0;
    const releases: (() => void)[] = [];
    const task = (host: string) => scheduler.run(host, async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      const count = (hostActive.get(host) ?? 0) + 1;
      hostActive.set(host, count);
      if (host === 'a') maxA = Math.max(maxA, count);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      hostActive.set(host, count - 1);
    });
    const promises = [task('a'), task('a'), task('a'), task('b'), task('c')];
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(active).toBe(3);
    expect(maxActive).toBe(3);
    expect(maxA).toBe(2);
    while (releases.length > 0) releases.shift()!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    while (releases.length > 0) releases.shift()!();
    await Promise.all(promises);
  });
});

describe('resolver network hardening', () => {
  it('deduplicates initial roots before applying the cap or fetching', async () => {
    const source = new MapSource({ 'A-MIB': mib('A-MIB') });
    const result = await new MibResolver({ sources: [source], cache: new InMemoryMibCache(), maxModules: 1 }).resolve({
      missingImports: [{ module: 'A-MIB', symbols: ['a'] }, { module: 'A-MIB', symbols: ['other'] }],
    });
    expect(result.status).toBe('resolved');
    expect(source.calls).toEqual(['A-MIB']);
  });

  it('retries one transient source failure', async () => {
    let attempts = 0;
    const source: MibSource = {
      id: 'retry', name: 'Retry', kind: 'memory', enabled: true, priority: 0, hosts: ['retry.test'],
      async fetch(module) {
        attempts += 1;
        if (attempts === 1) throw new Error('temporary reset');
        return { status: 'found', module, content: mib(module), sourceId: 'retry', location: 'memory:retry' };
      },
    };
    const result = await new MibResolver({ sources: [source], cache: new InMemoryMibCache() }).resolve({
      missingImports: [{ module: 'A-MIB', symbols: [] }],
    });
    expect(result.status).toBe('resolved');
    expect(attempts).toBe(2);
  });

  it('cools down a 429 source for subsequent dependencies', async () => {
    const calls: string[] = [];
    const limited: MibSource = {
      id: 'limited', name: 'Limited', kind: 'memory', enabled: true, priority: 0, hosts: ['limited.test'],
      async fetch(module) {
        calls.push(module);
        return { status: 'not-found', module, sourceId: 'limited', reason: 'rate limited', httpStatus: 429, retryAfterMs: 60_000 };
      },
    };
    const fallback = new MapSource({
      'A-MIB': mib('A-MIB', importFrom('b', 'B-MIB')),
      'B-MIB': mib('B-MIB'),
    });
    const events: ResolverProgress[] = [];
    const result = await new MibResolver({ sources: [limited, fallback], cache: new InMemoryMibCache() }).resolve({
      missingImports: [{ module: 'A-MIB', symbols: [] }],
      onProgress: (event) => events.push(event),
    });
    expect(result.status).toBe('resolved');
    expect(calls).toEqual(['A-MIB']);
    expect(events).toContainEqual(expect.objectContaining({ type: 'source-cooldown', sourceId: 'limited', httpStatus: 429 }));
  });

  it('limits parallel attempts to two per source host', async () => {
    let active = 0;
    let maxActive = 0;
    const source: MibSource = {
      id: 'slow', name: 'Slow', kind: 'memory', enabled: true, priority: 0, hosts: ['same.test'],
      async fetch(module) {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return { status: 'found', module, content: mib(module), sourceId: 'slow', location: `memory:${module}` };
      },
    };
    const result = await new MibResolver({ sources: [source], cache: new InMemoryMibCache() }).resolve({
      missingImports: ['A', 'B', 'C', 'D'].map((name) => ({ module: `${name}-MIB`, symbols: [] })),
    });
    expect(result.status).toBe('resolved');
    expect(maxActive).toBe(2);
  });

  it('propagates cancellation and never caches a result returned after abort', async () => {
    const cache = new InMemoryMibCache();
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const source: MibSource = {
      id: 'abort', name: 'Abort', kind: 'memory', enabled: true, priority: 0, hosts: ['abort.test'],
      async fetch(module, context) {
        receivedSignal = context?.signal;
        controller.abort();
        return { status: 'found', module, content: mib(module), sourceId: 'abort', location: 'memory:abort' };
      },
    };
    const result = await new MibResolver({ sources: [source], cache }).resolve({
      missingImports: [{ module: 'A-MIB', symbols: [] }], signal: controller.signal,
    });
    expect(receivedSignal).toBe(controller.signal);
    expect(result.status).toBe('cancelled');
    expect(await cache.get('A-MIB')).toBeUndefined();
  });

  it('rejects a declared-module mismatch and malformed SMI before caching', async () => {
    const cache = new InMemoryMibCache();
    const source = new MapSource({
      'A-MIB': mib('WRONG-MIB'),
      'B-MIB': 'B-MIB DEFINITIONS ::= BEGIN\nthis is not a declaration\nEND',
    });
    const result = await new MibResolver({ sources: [source], cache }).resolve({
      missingImports: [{ module: 'A-MIB', symbols: [] }, { module: 'B-MIB', symbols: [] }],
    });
    expect(result.status).toBe('failed');
    expect(result.failed.map(({ module }) => module).sort()).toEqual(['A-MIB', 'B-MIB']);
    expect(await cache.get('A-MIB')).toBeUndefined();
    expect(await cache.get('B-MIB')).toBeUndefined();
  });

  it('does not cache malformed content that also has a missing import', async () => {
    const cache = new InMemoryMibCache();
    const source = new MapSource({
      'BROKEN-MIB': `BROKEN-MIB DEFINITIONS ::= BEGIN
IMPORTS vendorRoot FROM VENDOR-ROOT-MIB;
this is not a declaration
END`,
    });
    const result = await new MibResolver({ sources: [source], cache }).resolve({
      missingImports: [{ module: 'BROKEN-MIB', symbols: [] }],
    });
    expect(result.status).toBe('failed');
    expect(await cache.get('BROKEN-MIB')).toBeUndefined();
  });

  it('emits source misses and aggregate progress with parent/count metadata', async () => {
    const source = new MapSource({ 'A-MIB': mib('A-MIB', importFrom('b', 'B-MIB')) });
    const events: ResolverProgress[] = [];
    await new MibResolver({ sources: [source], cache: new InMemoryMibCache() }).resolve({
      missingImports: [{ module: 'A-MIB', symbols: [] }], onProgress: (event) => events.push(event),
    });
    expect(events).toContainEqual(expect.objectContaining({ type: 'source-miss', module: 'B-MIB', sourceId: 'map', requestedBy: ['A-MIB'] }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'progress', completed: 2, total: 2 }));
  });
});

it('cancels queued scheduler work before it starts', async () => {
  const { HostScheduler } = await import('./scheduler');
  const scheduler = new HostScheduler({ maxConcurrent: 1, maxPerHost: 1 });
  let release!: () => void;
  const first = scheduler.run('host', () => new Promise<void>((resolve) => { release = resolve; }));
  const controller = new AbortController();
  let started = false;
  const second = scheduler.run('host', async () => { started = true; }, controller.signal);
  controller.abort();
  await expect(second).rejects.toThrow('aborted');
  release();
  await first;
  expect(started).toBe(false);
});

it('re-checks source cooldown after a queued scheduler attempt starts', async () => {
  const calls: string[] = [];
  const limited: MibSource = {
    id: 'queued-limit', name: 'Limited', kind: 'memory', enabled: true, priority: 0, hosts: ['same.test'],
    async fetch(module) {
      calls.push(module);
      if (module === 'A-MIB') return { status: 'not-found', module, sourceId: 'queued-limit', httpStatus: 429, retryAfterMs: 60_000 };
      return { status: 'found', module, sourceId: 'queued-limit', content: mib(module), location: `memory:${module}` };
    },
  };
  const fallback = new MapSource({ 'A-MIB': mib('A-MIB'), 'B-MIB': mib('B-MIB') });
  const { HostScheduler } = await import('./scheduler');
  const result = await new MibResolver({
    sources: [limited, fallback], cache: new InMemoryMibCache(),
    scheduler: new HostScheduler({ maxConcurrent: 1, maxPerHost: 1 }),
  }).resolve({ missingImports: [{ module: 'A-MIB', symbols: [] }, { module: 'B-MIB', symbols: [] }] });
  expect(result.status).toBe('resolved');
  expect(calls).toEqual(['A-MIB']);
});
