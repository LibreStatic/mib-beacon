import { describe, expect, it, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createNodeTransport,
  createPersistentSecretStore,
  nodeStorageFactory,
  type SecretCodec,
} from '@mibbeacon/transport/node';
import type { HttpClient, Transport } from '@mibbeacon/transport';
import { createEngine } from './engine';
import type { ResolverOperationStatus, ResolverSourceDraft } from './api/engine-api';

const LEAF = `LEAF-MIB DEFINITIONS ::= BEGIN
IMPORTS enterprises FROM SNMPv2-SMI;
leafNode OBJECT IDENTIFIER ::= { enterprises 99001 }
END`;
const DEPENDENCY = `DEPENDENCY-MIB DEFINITIONS ::= BEGIN
IMPORTS leafNode FROM LEAF-MIB;
dependencyNode OBJECT IDENTIFIER ::= { leafNode 1 }
END`;
const ROOT = `ROOT-MIB DEFINITIONS ::= BEGIN
IMPORTS dependencyNode FROM DEPENDENCY-MIB;
rootNode OBJECT IDENTIFIER ::= { dependencyNode 1 }
END`;
const SECOND_ROOT = ROOT.replaceAll('ROOT-MIB', 'SECOND-ROOT-MIB').replaceAll(
  'rootNode',
  'secondRootNode',
);
const CONCURRENT = `CONCURRENT-MIB DEFINITIONS ::= BEGIN
IMPORTS enterprises FROM SNMPv2-SMI;
concurrentNode OBJECT IDENTIFIER ::= { enterprises 99002 }
END`;

function sourceDraft(): ResolverSourceDraft {
  return {
    config: {
      id: 'fixture',
      kind: 'http-template',
      name: 'Fixture source',
      enabled: true,
      priority: 0,
      urlTemplate: 'https://mibs.example/@mib@',
      authKind: 'none',
      passwordRef: 'must-not-export',
    },
  };
}

function transportWith(http: HttpClient, dataDir = tmpdir()): Transport {
  return { ...createNodeTransport({ dataDir }), http };
}

function fixtureHttp(): HttpClient & { fetch: ReturnType<typeof vi.fn> } {
  const documents: Record<string, string> = {
    'LEAF-MIB': LEAF,
    'DEPENDENCY-MIB': DEPENDENCY,
  };
  return {
    fetch: vi.fn(async ({ url }) => {
      const name = decodeURIComponent(url.split('/').pop() ?? '').replace(/\.(?:txt|mib|my)$/i, '');
      const text = documents[name.toUpperCase()];
      return text
        ? { status: 200, ok: true, headers: {}, text, bytes: text.length }
        : { status: 404, ok: false, headers: {}, text: '', bytes: 0 };
    }),
  };
}

async function waitForTerminal(engine: ReturnType<typeof createEngine>, handleId: string) {
  for (let index = 0; index < 100; index += 1) {
    const status = await engine.resolver.status(handleId);
    if (['done', 'partial', 'error', 'cancelled', 'expired'].includes(status.state)) return status;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('operation did not finish');
}

async function waitForState(
  engine: ReturnType<typeof createEngine>,
  handleId: string,
  expected: ResolverOperationStatus['state'],
) {
  for (let index = 0; index < 100; index += 1) {
    const status = await engine.resolver.status(handleId);
    if (status?.state === expected) return status;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`operation did not reach ${expected}`);
}

async function enableResolver(engine: ReturnType<typeof createEngine>) {
  await engine.resolver.settings.update({ enabled: true, autoResolveImports: true });
}

describe('engine resolver orchestration', () => {
  it('keeps all resolver network automation disabled on a fresh install', async () => {
    const engine = createEngine(transportWith(fixtureHttp()), { dbPath: ':memory:' });

    await expect(engine.resolver.settings.get()).resolves.toEqual({
      enabled: false,
      autoResolveImports: false,
      externalConsentRemembered: false,
    });
  });

  it('blocks every explicit external resolver operation until the master switch is enabled', async () => {
    const http = fixtureHttp();
    const engine = createEngine(transportWith(http), { dbPath: ':memory:' });
    const source = await engine.resolver.sources.create(sourceDraft());

    const sourceTest = await engine.resolver.sources.test(source.id, 'LEAF-MIB');
    const preview = await engine.resolver.sources.preview({
      config: {
        id: 'disabled-preview',
        kind: 'json-catalog',
        name: 'Disabled preview',
        enabled: true,
        priority: 0,
        catalogUrl: 'https://catalog.example/catalog.json',
        urlQuery: '$.mibs[*].file',
        nameQuery: '$.mibs[*].name',
        authKind: 'none',
      },
    });
    const oidLookup = await engine.resolver.lookupOid({
      oid: '1.3.6.1.4.1.424242',
      network: true,
    });

    for (const operation of [sourceTest, preview, oidLookup]) {
      await expect(waitForTerminal(engine, operation.handleId)).resolves.toMatchObject({
        state: 'error',
        result: { code: 'RESOLVER_DISABLED' },
      });
    }
    expect(http.fetch).not.toHaveBeenCalled();

    const localLookup = await engine.resolver.lookupOid({
      oid: '1.3.6.1.4.1.424242',
      network: false,
    });
    await expect(waitForTerminal(engine, localLookup.handleId)).resolves.toMatchObject({
      state: 'done',
    });
    expect(http.fetch).not.toHaveBeenCalled();
  });

  it('serializes a direct catalog mutation behind a consent-delayed resolver import', async () => {
    const engine = createEngine(transportWith(fixtureHttp()), { dbPath: ':memory:' });
    await enableResolver(engine);
    await engine.resolver.sources.create(sourceDraft());
    const operation = await engine.mibs.startImport({
      files: [{ name: 'root.mib', content: ROOT }],
    });
    await waitForState(engine, operation.handleId, 'awaiting-consent');
    let directFinished = false;
    const direct = engine.mibs
      .importTexts([{ name: 'concurrent.mib', content: CONCURRENT }])
      .then((result) => {
        directFinished = true;
        return result;
      });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(directFinished).toBe(false);

    await engine.resolver.respondConsent(operation.handleId, { allow: true, askAgain: true });
    await expect(waitForTerminal(engine, operation.handleId)).resolves.toMatchObject({
      state: 'done',
    });
    await expect(direct).resolves.toMatchObject({ loaded: ['CONCURRENT-MIB'] });
    expect(await engine.mibs.node('rootNode')).not.toBeNull();
    expect(await engine.mibs.node('concurrentNode')).not.toBeNull();
  });
  it('waits for consent without making a network request, then recursively loads dependencies leaf-first', async () => {
    const http = fixtureHttp();
    const engine = createEngine(transportWith(http), { dbPath: ':memory:' });
    await enableResolver(engine);
    await engine.resolver.sources.create(sourceDraft());
    const events: string[] = [];
    engine.events.subscribe('resolver', (event) => events.push(event.kind));

    const { handleId } = await engine.mibs.startImport({
      files: [{ name: 'root.mib', content: ROOT }],
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(http.fetch).not.toHaveBeenCalled();
    await expect(engine.resolver.status(handleId)).resolves.toMatchObject({
      state: 'awaiting-consent',
      missingModules: ['DEPENDENCY-MIB'],
      sourceHosts: expect.arrayContaining(['mibs.example']),
    });
    expect(events).toEqual(expect.arrayContaining(['started', 'local-result', 'consent-required']));

    await engine.resolver.respondConsent(handleId, { allow: true, askAgain: true });
    await expect(waitForTerminal(engine, handleId)).resolves.toMatchObject({
      state: 'done',
      loadedModules: expect.arrayContaining(['LEAF-MIB', 'DEPENDENCY-MIB', 'ROOT-MIB']),
    });
    expect((await engine.mibs.node('rootNode'))?.oid).toBe('1.3.6.1.4.1.99001.1.1');
    expect(events.at(-1)).toBe('done');
  });

  it('persists remembered consent and completes a later import automatically', async () => {
    const http = fixtureHttp();
    const engine = createEngine(transportWith(http), { dbPath: ':memory:' });
    await enableResolver(engine);
    await engine.resolver.sources.create(sourceDraft());
    const first = await engine.mibs.startImport({ files: [{ name: 'root.mib', content: ROOT }] });
    await waitForState(engine, first.handleId, 'awaiting-consent');
    await engine.resolver.respondConsent(first.handleId, { allow: true, askAgain: false });
    await waitForTerminal(engine, first.handleId);
    await engine.mibs.unload('ROOT-MIB');
    await engine.mibs.unload('DEPENDENCY-MIB');

    const second = await engine.mibs.startImport({
      files: [{ name: 'second.mib', content: SECOND_ROOT }],
    });
    await expect(waitForTerminal(engine, second.handleId)).resolves.toMatchObject({
      state: 'done',
    });
    await expect(engine.resolver.settings.get()).resolves.toMatchObject({
      externalConsentRemembered: true,
    });
  });

  it('replays cached dependencies offline without asking for consent', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mibbeacon-resolver-cache-'));
    const dbPath = join(dir, 'mibbeacon.db');
    const http = fixtureHttp();
    const engine1 = createEngine(transportWith(http, dir), { dbPath });
    await enableResolver(engine1);
    await engine1.resolver.sources.create(sourceDraft());
    const first = await engine1.mibs.startImport({ files: [{ name: 'root.mib', content: ROOT }] });
    await waitForState(engine1, first.handleId, 'awaiting-consent');
    await engine1.resolver.respondConsent(first.handleId, { allow: true, askAgain: true });
    await waitForTerminal(engine1, first.handleId);

    const db = nodeStorageFactory.open(dbPath);
    db.run("DELETE FROM mib_modules WHERE name IN ('ROOT-MIB','DEPENDENCY-MIB','LEAF-MIB')");
    db.close();
    const offline: HttpClient = {
      fetch: vi.fn(async () => {
        throw new Error('offline');
      }),
    };
    const engine2 = createEngine(transportWith(offline, dir), { dbPath });
    const consentEvents: string[] = [];
    engine2.events.subscribe('resolver', (event) => consentEvents.push(event.kind));
    const second = await engine2.mibs.startImport({
      files: [{ name: 'second.mib', content: SECOND_ROOT }],
    });

    await expect(waitForTerminal(engine2, second.handleId)).resolves.toMatchObject({
      state: 'done',
    });
    expect(offline.fetch).not.toHaveBeenCalled();
    expect(consentEvents).not.toContain('consent-required');
  });

  it('cancels or expires waiting operations without network access', async () => {
    const http = fixtureHttp();
    let now = 100;
    const engine = createEngine(transportWith(http), {
      dbPath: ':memory:',
      resolver: { now: () => now, consentTtlMs: 10 },
    });
    await enableResolver(engine);
    await engine.resolver.sources.create(sourceDraft());
    const cancelled = await engine.mibs.startImport({
      files: [{ name: 'root.mib', content: ROOT }],
    });
    await engine.resolver.cancel(cancelled.handleId);
    await expect(engine.resolver.status(cancelled.handleId)).resolves.toMatchObject({
      state: 'cancelled',
    });

    const expiring = await engine.mibs.startImport({
      files: [{ name: 'root.mib', content: ROOT }],
    });
    await waitForState(engine, expiring.handleId, 'awaiting-consent');
    now = 111;
    await expect(waitForTerminal(engine, expiring.handleId)).resolves.toMatchObject({
      state: 'expired',
    });
    expect(http.fetch).not.toHaveBeenCalled();
  });

  it('persists source CRUD/order and exports configurations without secret references', async () => {
    const engine = createEngine(transportWith(fixtureHttp()), { dbPath: ':memory:' });
    const created = await engine.resolver.sources.create(sourceDraft());
    expect(created.builtIn).toBe(false);
    await engine.resolver.sources.reorder([created.id, 'pysnmp', 'cache']);
    expect((await engine.resolver.sources.list())[0]?.id).toBe(created.id);
    const exported = await engine.resolver.sources.exportCustom();
    expect(exported).not.toContain('must-not-export');
    await engine.resolver.sources.remove(created.id);
    expect((await engine.resolver.sources.list()).some((source) => source.id === created.id)).toBe(
      false,
    );
  });

  it('honors persisted source order in the actual resolver request log', async () => {
    const requested: string[] = [];
    const http: HttpClient = {
      fetch: vi.fn(async ({ url }) => {
        requested.push(url);
        const text = url.startsWith('https://preferred.example/') ? LEAF : undefined;
        return text
          ? { status: 200, ok: true, headers: {}, text, bytes: text.length }
          : { status: 404, ok: false, headers: {}, text: '', bytes: 0 };
      }),
    };
    const engine = createEngine(transportWith(http), { dbPath: ':memory:' });
    await engine.resolver.settings.update({
      enabled: true,
      autoResolveImports: true,
      externalConsentRemembered: true,
    });
    const first = sourceDraft();
    first.config.id = 'fallback';
    first.config.name = 'Fallback';
    first.config.urlTemplate = 'https://fallback.example/@mib@';
    const second = sourceDraft();
    second.config.id = 'preferred';
    second.config.name = 'Preferred';
    second.config.urlTemplate = 'https://preferred.example/@mib@';
    await engine.resolver.sources.create(first);
    await engine.resolver.sources.create(second);
    const listed = await engine.resolver.sources.list();
    await engine.resolver.sources.reorder([
      'cache',
      'preferred',
      'fallback',
      ...listed
        .filter((source) => !['cache', 'preferred', 'fallback'].includes(source.id))
        .map((source) => source.id),
    ]);

    const operation = await engine.resolver.resolveModules(['LEAF-MIB']);
    await expect(waitForTerminal(engine, operation.handleId)).resolves.toMatchObject({
      state: 'done',
    });
    expect(requested[0]).toMatch(/^https:\/\/preferred\.example\//);
    expect(requested.some((url) => url.startsWith('https://fallback.example/'))).toBe(false);
  });

  it('reports and clears cache statistics and aggregates loaded and external OID information', async () => {
    const http = fixtureHttp();
    const engine = createEngine(transportWith(http), { dbPath: ':memory:' });
    await enableResolver(engine);
    await engine.resolver.sources.create(sourceDraft());
    const operation = await engine.mibs.startImport({
      files: [{ name: 'root.mib', content: ROOT }],
    });
    await waitForState(engine, operation.handleId, 'awaiting-consent');
    await engine.resolver.respondConsent(operation.handleId, { allow: true, askAgain: true });
    await waitForTerminal(engine, operation.handleId);
    await expect(engine.resolver.cache.stats()).resolves.toMatchObject({ entries: 2 });
    await engine.resolver.cache.clear();
    await expect(engine.resolver.cache.stats()).resolves.toMatchObject({ entries: 0, bytes: 0 });

    const lookup = await engine.resolver.lookupOid({
      oid: '1.3.6.1.4.1.99001.1.1',
      network: false,
    });
    const lookupStatus = await waitForTerminal(engine, lookup.handleId);
    expect((lookupStatus.result as { loaded?: { name?: string } }).loaded?.name).toBe('rootNode');
  });

  it('offers and loads a cached-but-unloaded module without external access', async () => {
    const http = fixtureHttp();
    const engine = createEngine(transportWith(http), { dbPath: ':memory:' });
    await enableResolver(engine);
    await engine.resolver.sources.create(sourceDraft());
    const imported = await engine.mibs.startImport({
      files: [{ name: 'root.mib', content: ROOT }],
    });
    await waitForState(engine, imported.handleId, 'awaiting-consent');
    await engine.resolver.respondConsent(imported.handleId, { allow: true, askAgain: true });
    await expect(waitForTerminal(engine, imported.handleId)).resolves.toMatchObject({
      state: 'done',
    });
    await engine.mibs.unload('ROOT-MIB');
    await engine.mibs.unload('DEPENDENCY-MIB');
    await engine.mibs.unload('LEAF-MIB');
    http.fetch.mockClear();

    const lookup = await engine.resolver.lookupOid({ oid: '1.3.6.1.4.1.99001', network: false });
    await expect(waitForTerminal(engine, lookup.handleId)).resolves.toMatchObject({
      state: 'done',
      result: { cached: expect.objectContaining({ name: 'leafNode', module: 'LEAF-MIB' }) },
    });

    const load = await engine.resolver.loadCachedModules(['LEAF-MIB']);
    await expect(waitForTerminal(engine, load.handleId)).resolves.toMatchObject({
      state: 'done',
      loadedModules: expect.arrayContaining(['LEAF-MIB']),
    });
    expect((await engine.mibs.resolve('1.3.6.1.4.1.99001'))?.name).toBe('leafNode');
    expect(http.fetch).not.toHaveBeenCalled();
  });

  it('caches the IANA registry across OIDs and rate-limits oid-base calls', async () => {
    const oidBaseTimes: number[] = [];
    const http: HttpClient & { fetch: ReturnType<typeof vi.fn> } = {
      fetch: vi.fn(async ({ url }) => {
        if (url.includes('enterprise-numbers.txt')) {
          const text = '9\n  Cisco Systems\n  Contact\n';
          return { status: 200, ok: true, headers: {}, text, bytes: text.length };
        }
        if (url.includes('oid-base.com')) {
          oidBaseTimes.push(Date.now());
          const text = '---\noid: 1.3.6.1.4.1.9\ndescription: Cisco\n---\n';
          return { status: 200, ok: true, headers: {}, text, bytes: text.length };
        }
        const text = '<title>OID reference</title>';
        return { status: 200, ok: true, headers: {}, text, bytes: text.length };
      }),
    };
    const engine = createEngine(transportWith(http), {
      dbPath: ':memory:',
      resolver: { oidBaseIntervalMs: 25 },
    });
    await engine.resolver.settings.update({ enabled: true, externalConsentRemembered: true });

    for (const oid of ['1.3.6.1.4.1.9.9.1', '1.3.6.1.4.1.9.9.2']) {
      const operation = await engine.resolver.lookupOid({ oid, network: true });
      await expect(waitForTerminal(engine, operation.handleId)).resolves.toMatchObject({
        state: 'done',
        result: {
          enterprise: expect.objectContaining({ number: 9, organization: 'Cisco Systems' }),
        },
      });
    }

    expect(
      http.fetch.mock.calls.filter(([request]) => request.url.includes('enterprise-numbers.txt')),
    ).toHaveLength(1);
    expect(oidBaseTimes).toHaveLength(2);
    expect(oidBaseTimes[1]! - oidBaseTimes[0]!).toBeGreaterThanOrEqual(20);
  });

  it('returns a structured null status for unknown handles', async () => {
    const engine = createEngine(transportWith(fixtureHttp()), { dbPath: ':memory:' });
    const status: ResolverOperationStatus | null = await engine.resolver.status('missing');
    expect(status).toBeNull();
  });

  it('never emits or stores downloaded document bodies and strips terminal operation context', async () => {
    const dbPath = join(await mkdtemp(join(tmpdir(), 'mibbeacon-redaction-')), 'mibbeacon.db');
    const engine = createEngine(transportWith(fixtureHttp()), { dbPath });
    await enableResolver(engine);
    await engine.resolver.sources.create(sourceDraft());
    const eventPayloads: unknown[] = [];
    engine.events.subscribe('resolver', (event) => eventPayloads.push(event.payload));
    const operation = await engine.mibs.startImport({
      files: [{ name: 'root.mib', content: ROOT }],
    });
    await waitForState(engine, operation.handleId, 'awaiting-consent');
    await engine.resolver.respondConsent(operation.handleId, { allow: true, askAgain: true });
    const terminal = await waitForTerminal(engine, operation.handleId);

    expect(JSON.stringify(eventPayloads)).not.toContain(LEAF);
    expect(terminal.missingModules).toEqual([]);
    expect(terminal.sourceHosts).toEqual([]);
    const db = nodeStorageFactory.open(dbPath);
    expect(
      db.get<{ result_json: string }>('SELECT result_json FROM resolver_history')?.result_json,
    ).not.toContain(LEAF);
    db.close();
  });

  it('runs source tests and online OID lookup as consent-gated operations and lists bounded history', async () => {
    const http = fixtureHttp();
    const engine = createEngine(transportWith(http), { dbPath: ':memory:' });
    await enableResolver(engine);
    const source = await engine.resolver.sources.create(sourceDraft());
    const testOperation = await engine.resolver.sources.test(source.id, 'LEAF-MIB');
    await waitForState(engine, testOperation.handleId, 'awaiting-consent');
    expect(http.fetch).not.toHaveBeenCalled();
    await engine.resolver.respondConsent(testOperation.handleId, { allow: true, askAgain: true });
    await expect(waitForTerminal(engine, testOperation.handleId)).resolves.toMatchObject({
      state: 'done',
      result: expect.objectContaining({ ok: true, module: 'LEAF-MIB' }),
    });
    await expect(engine.resolver.sources.list()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: source.id,
          stats: expect.objectContaining({ lastResult: 'Found LEAF-MIB' }),
        }),
      ]),
    );

    const lookupOperation = await engine.resolver.lookupOid({
      oid: '1.3.6.1.4.1.99001',
      network: true,
    });
    await waitForState(engine, lookupOperation.handleId, 'awaiting-consent');
    await engine.resolver.respondConsent(lookupOperation.handleId, {
      allow: false,
      askAgain: true,
    });
    await expect(engine.resolver.history.list(1)).resolves.toHaveLength(1);
  });

  it.each([401, 403])('reports HTTP %s source tests as authentication failures', async (status) => {
    const http: HttpClient & { fetch: ReturnType<typeof vi.fn> } = {
      fetch: vi.fn(async () => ({
        status,
        ok: false,
        headers: {},
        text: '',
        bytes: 0,
      })),
    };
    const engine = createEngine(transportWith(http), { dbPath: ':memory:' });
    await enableResolver(engine);
    const source = await engine.resolver.sources.create(sourceDraft());
    const operation = await engine.resolver.sources.test(source.id, 'PRIVATE-MIB');
    await waitForState(engine, operation.handleId, 'awaiting-consent');
    await engine.resolver.respondConsent(operation.handleId, { allow: true, askAgain: true });

    await expect(waitForTerminal(engine, operation.handleId)).resolves.toMatchObject({
      state: 'error',
      result: {
        ok: false,
        sourceId: source.id,
        module: 'PRIVATE-MIB',
        code: 'SOURCE_AUTH_FAILED',
        stage: 'auth',
        httpStatus: status,
      },
    });
    expect(http.fetch).toHaveBeenCalledTimes(1);
  });

  it('reports content-validation failures with the exact stage and a bounded response excerpt', async () => {
    const body = '<!DOCTYPE html><html><body>soft 200 login page</body></html>';
    const http: HttpClient = {
      fetch: vi.fn(async () => ({
        status: 200,
        ok: true,
        headers: {},
        text: body,
        bytes: body.length,
      })),
    };
    const engine = createEngine(transportWith(http), { dbPath: ':memory:' });
    await engine.resolver.settings.update({ enabled: true, externalConsentRemembered: true });
    const draft = sourceDraft();
    draft.config.fixedExtension = '.mib';
    const source = await engine.resolver.sources.create(draft);

    const operation = await engine.resolver.sources.test(source.id, 'PRIVATE-MIB');
    await expect(waitForTerminal(engine, operation.handleId)).resolves.toMatchObject({
      state: 'error',
      result: {
        ok: false,
        sourceId: source.id,
        module: 'PRIVATE-MIB',
        code: 'MODULE_NOT_FOUND',
        stage: 'validation',
        responseExcerpt: body,
      },
    });
  });

  it('preserves secret refs on redacted updates and replaces/deletes superseded secrets', async () => {
    const secrets = new Map<string, string>();
    const base = createNodeTransport({ dataDir: tmpdir() });
    const transport: Transport = {
      ...base,
      secrets: {
        set: async (key, value) => {
          secrets.set(key, value);
        },
        get: async (key) => secrets.get(key) ?? null,
        delete: async (key) => {
          secrets.delete(key);
        },
        isEncrypted: () => true,
      },
    };
    const engine = createEngine(transport, { dbPath: ':memory:' });
    const draft = sourceDraft();
    draft.config.authKind = 'basic';
    draft.config.username = 'user';
    draft.secrets = { password: 'first' };
    const created = await engine.resolver.sources.create(draft);
    const firstRef = 'passwordRef' in created ? created.passwordRef : undefined;
    expect(firstRef).toBeTruthy();

    const redacted = JSON.parse(await engine.resolver.sources.exportCustom()) as {
      sources: (typeof created)[];
    };
    await engine.resolver.sources.update(created.id, { config: redacted.sources[0]! });
    const preserved = (await engine.resolver.sources.list()).find(
      (item) => item.id === created.id,
    )!;
    expect('passwordRef' in preserved && preserved.passwordRef).toBe(firstRef);

    await engine.resolver.sources.update(created.id, {
      config: preserved,
      secrets: { password: 'second' },
    });
    const replacement = (await engine.resolver.sources.list()).find(
      (item) => item.id === created.id,
    )!;
    expect('passwordRef' in replacement && replacement.passwordRef).toBeTruthy();
    expect(secrets.size).toBe(1);
  });

  it('strictly rejects malformed discriminated source configurations', async () => {
    const engine = createEngine(transportWith(fixtureHttp()), { dbPath: ':memory:' });
    await expect(
      engine.resolver.sources.importCustom(
        JSON.stringify({
          version: 1,
          sources: [{ id: 'bad', kind: 'github-tree', name: 'Bad', enabled: true, priority: 0 }],
        }),
      ),
    ).rejects.toThrow(/invalid resolver source/i);
    await expect(
      engine.resolver.sources.create({
        config: { id: 'custom-cache', kind: 'cache', name: 'Cache', enabled: true, priority: 0 },
      }),
    ).rejects.toThrow(/cache.*built-in/i);
  });

  it('uses loaded/local OID evidence before consent and only prompts on an aggregate miss', async () => {
    const engine = createEngine(transportWith(fixtureHttp()), { dbPath: ':memory:' });
    await enableResolver(engine);
    await engine.mibs.importTexts([{ name: 'leaf.mib', content: LEAF }]);
    const local = await engine.resolver.lookupOid({ oid: '1.3.6.1.4.1.99001', network: true });
    await expect(waitForTerminal(engine, local.handleId)).resolves.toMatchObject({
      state: 'done',
      result: expect.objectContaining({ loaded: expect.objectContaining({ name: 'leafNode' }) }),
    });

    const miss = await engine.resolver.lookupOid({ oid: '1.3.6.1.4.1.123456', network: true });
    await expect(waitForState(engine, miss.handleId, 'awaiting-consent')).resolves.toBeTruthy();
  });

  it('stores custom sensitive headers only through SecretStore refs and supports explicit clearing', async () => {
    const secrets = new Map<string, string>();
    const base = createNodeTransport({ dataDir: tmpdir() });
    const engine = createEngine(
      {
        ...base,
        secrets: {
          set: async (key, value) => {
            secrets.set(key, value);
          },
          get: async (key) => secrets.get(key) ?? null,
          delete: async (key) => {
            secrets.delete(key);
          },
          isEncrypted: () => true,
        },
      },
      { dbPath: ':memory:' },
    );
    const draft = sourceDraft();
    draft.secrets = { headers: { 'X-Api-Key': 'private-value' } };
    const created = await engine.resolver.sources.create(draft);
    expect('secretHeaders' in created && created.secretHeaders?.['X-Api-Key']).toBeTruthy();
    expect(await engine.resolver.sources.exportCustom()).not.toContain('private-value');
    expect(await engine.resolver.sources.exportCustom()).not.toContain('secretHeaders');

    await engine.resolver.sources.update(created.id, {
      config: created,
      clearSecrets: ['headers'],
    });
    expect(secrets.size).toBe(0);
  });

  it('rejects credential-bearing source drafts when encrypted storage is unavailable', async () => {
    const engine = createEngine(transportWith(fixtureHttp()), { dbPath: ':memory:' });
    const draft = sourceDraft();
    draft.config.authKind = 'basic';
    draft.config.username = 'reader';
    draft.secrets = { password: 'must-not-be-stored' };

    await expect(engine.resolver.sources.create(draft)).rejects.toThrow(
      /encrypted credential storage is unavailable/i,
    );
    expect((await engine.resolver.sources.list()).some((source) => source.id === 'fixture')).toBe(
      false,
    );

    const plain = await engine.resolver.sources.create(sourceDraft());
    await expect(
      engine.resolver.sources.update(plain.id, {
        config: plain,
        secrets: { headers: { Authorization: 'must-not-be-stored' } },
      }),
    ).rejects.toThrow(/encrypted credential storage is unavailable/i);
    expect(await engine.resolver.sources.exportCustom()).not.toContain('Authorization');
  });

  it('reloads resolver credentials from an encrypted persistent store', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mibbeacon-engine-secrets-'));
    const dbPath = join(directory, 'mibbeacon.db');
    const secretPath = join(directory, 'secrets.json');
    const codec: SecretCodec = {
      encrypt: (plaintext) => Buffer.from(`encrypted:${plaintext}`).toString('base64'),
      decrypt: (ciphertext) =>
        Buffer.from(ciphertext, 'base64')
          .toString()
          .replace(/^encrypted:/, ''),
      isEncrypted: () => true,
    };
    const firstSecrets = createPersistentSecretStore({ filePath: secretPath, codec });
    const firstTransport = createNodeTransport({ dataDir: directory, secrets: firstSecrets });
    const first = createEngine({ ...firstTransport, http: fixtureHttp() }, { dbPath });
    const draft = sourceDraft();
    draft.config.authKind = 'basic';
    draft.config.username = 'reader';
    draft.secrets = { password: 'persistent-password' };
    const created = await first.resolver.sources.create(draft);
    const reference = created.kind === 'http-template' ? created.passwordRef : undefined;
    expect(reference).toBeTruthy();

    const secondSecrets = createPersistentSecretStore({ filePath: secretPath, codec });
    const secondTransport = createNodeTransport({ dataDir: directory, secrets: secondSecrets });
    const second = createEngine({ ...secondTransport, http: fixtureHttp() }, { dbPath });
    const reloaded = (await second.resolver.sources.list()).find(
      (source) => source.id === created.id,
    );
    expect(reloaded).toMatchObject({ id: created.id, enabled: true });
    await expect(secondSecrets.get(reference!)).resolves.toBe('persistent-password');
  });

  it('rejects explicit FTPS sources on React Native with an actionable error', async () => {
    const transport = { ...transportWith(fixtureHttp()), platform: 'react-native' as const };
    const engine = createEngine(transport, { dbPath: ':memory:' });

    await expect(
      engine.resolver.sources.create({
        config: {
          id: 'mobile-ftps',
          kind: 'ftp',
          name: 'Mobile FTPS',
          enabled: true,
          priority: 0,
          host: 'ftp.example.test',
          secure: 'ftps-explicit',
          anonymous: true,
          pathTemplate: '/mibs/@mib@',
        },
      }),
    ).rejects.toThrow(/explicit FTPS.*not supported.*React Native.*certificate.*hostname/i);

    await expect(
      engine.resolver.sources.create({
        config: {
          id: 'mobile-ftp',
          kind: 'ftp',
          name: 'Mobile FTP',
          enabled: true,
          priority: 0,
          host: 'ftp.example.test',
          secure: 'none',
          anonymous: true,
          pathTemplate: '/mibs/@mib@',
        },
      }),
    ).resolves.toMatchObject({ id: 'mobile-ftp' });
  });

  it('strictly validates source URLs, templates, JSONPaths, and imported configurations atomically', async () => {
    const engine = createEngine(transportWith(fixtureHttp()), { dbPath: ':memory:' });
    await expect(
      engine.resolver.sources.create({
        config: {
          id: 'bad-template',
          kind: 'http-template',
          name: 'Bad template',
          enabled: true,
          priority: 0,
          urlTemplate: 'javascript:alert(@mib@)',
          authKind: 'none',
        },
      }),
    ).rejects.toThrow(/HTTP URL template.*http.*https/i);
    await expect(
      engine.resolver.sources.create({
        config: {
          id: 'append-template',
          kind: 'http-template',
          name: 'Append template',
          enabled: true,
          priority: 0,
          urlTemplate: 'https://mibs.example/static/',
          authKind: 'none',
        },
      }),
    ).resolves.toMatchObject({
      id: 'append-template',
      urlTemplate: 'https://mibs.example/static/',
    });
    await expect(
      engine.resolver.sources.create({
        config: {
          id: 'bad-catalog',
          kind: 'json-catalog',
          name: 'Bad catalog',
          enabled: true,
          priority: 0,
          catalogUrl: 'not a URL',
          urlQuery: '$..files',
          authKind: 'none',
        },
      }),
    ).rejects.toThrow(/catalog URL|JSONPath/i);

    const good = sourceDraft().config;
    const bad = {
      id: 'bad-import',
      kind: 'json-catalog',
      name: 'Bad import',
      enabled: true,
      priority: 1,
      catalogUrl: 'https://catalog.example/index.json',
      urlQuery: '$[?(@.url)]',
      authKind: 'none',
    };
    await expect(
      engine.resolver.sources.importCustom(
        JSON.stringify({
          version: 1,
          sources: [good, bad],
        }),
      ),
    ).rejects.toThrow(/JSONPath/i);
    expect((await engine.resolver.sources.list()).some((source) => source.id === good.id)).toBe(
      false,
    );
  });

  it('disables and reports one invalid persisted source without hiding valid resolver sources', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mibbeacon-invalid-source-'));
    const dbPath = join(directory, 'mibbeacon.db');
    const engine = createEngine(transportWith(fixtureHttp(), directory), { dbPath });
    await enableResolver(engine);
    await engine.resolver.sources.create(sourceDraft());
    const db = nodeStorageFactory.open(dbPath);
    const invalid = {
      id: 'persisted-bad',
      kind: 'http-template',
      name: 'Persisted bad',
      enabled: true,
      priority: -1,
      urlTemplate: 'https://example.test/@mib@',
      modulePattern: '[',
      authKind: 'none',
    };
    db.run(
      `INSERT INTO resolver_sources
       (id, kind, name, enabled, priority, built_in, config_json, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, 0, ?, 1, 1)`,
      [invalid.id, invalid.kind, invalid.name, invalid.priority, JSON.stringify(invalid)],
    );
    db.close();

    const listed = await engine.resolver.sources.list();
    expect(listed.find((source) => source.id === invalid.id)).toMatchObject({
      enabled: false,
      validationError: expect.stringMatching(/module regular expression/i),
    });
    const operation = await engine.resolver.sources.test('fixture', 'LEAF-MIB');
    await waitForState(engine, operation.handleId, 'awaiting-consent');
    await engine.resolver.respondConsent(operation.handleId, { allow: true, askAgain: true });
    await expect(waitForTerminal(engine, operation.handleId)).resolves.toMatchObject({
      state: 'done',
      result: expect.objectContaining({ ok: true, sourceId: 'fixture' }),
    });
  });

  it('never persists, reads, or deletes caller-supplied secret references', async () => {
    const secrets = new Map([['agent:private-community', 'do-not-touch']]);
    const base = createNodeTransport({ dataDir: tmpdir() });
    const engine = createEngine(
      {
        ...base,
        secrets: {
          set: async (key, value) => {
            secrets.set(key, value);
          },
          get: async (key) => secrets.get(key) ?? null,
          delete: async (key) => {
            secrets.delete(key);
          },
          isEncrypted: () => true,
        },
      },
      { dbPath: ':memory:' },
    );
    const config = {
      ...sourceDraft().config,
      authKind: 'basic' as const,
      username: 'attacker',
      passwordRef: 'agent:private-community',
      secretHeaders: { Authorization: 'agent:private-community' },
    };
    const created = await engine.resolver.sources.create({ config });
    expect('passwordRef' in created && created.passwordRef).toBeFalsy();
    expect('secretHeaders' in created && created.secretHeaders).toBeFalsy();
    await engine.resolver.sources.remove(created.id);
    expect(secrets.get('agent:private-community')).toBe('do-not-touch');

    const github = await engine.resolver.sources.create({
      config: {
        id: 'evil-github',
        kind: 'github-tree',
        name: 'Evil',
        enabled: true,
        priority: 0,
        owner: 'evil',
        repo: 'mibs',
        branch: 'main',
        tokenRef: 'agent:private-community',
      },
    });
    expect(github.kind === 'github-tree' && github.tokenRef).toBeFalsy();
    await engine.resolver.sources.remove(github.id);
    expect(secrets.get('agent:private-community')).toBe('do-not-touch');
  });

  it('accepts immediate consent or cancellation from the consent-required event callback', async () => {
    const engine = createEngine(transportWith(fixtureHttp()), { dbPath: ':memory:' });
    await enableResolver(engine);
    await engine.resolver.sources.create(sourceDraft());
    engine.events.subscribe('resolver', (event) => {
      if (event.kind === 'consent-required' && event.handleId) {
        void engine.resolver.respondConsent(event.handleId, { allow: true, askAgain: true });
      }
    });
    const operation = await engine.mibs.startImport({
      files: [{ name: 'root.mib', content: ROOT }],
    });
    await expect(waitForTerminal(engine, operation.handleId)).resolves.toMatchObject({
      state: 'done',
    });

    const cancelling = createEngine(transportWith(fixtureHttp()), { dbPath: ':memory:' });
    await enableResolver(cancelling);
    await cancelling.resolver.sources.create(sourceDraft());
    cancelling.events.subscribe('resolver', (event) => {
      if (event.kind === 'consent-required' && event.handleId) {
        void cancelling.resolver.cancel(event.handleId);
      }
    });
    const cancelled = await cancelling.mibs.startImport({
      files: [{ name: 'root.mib', content: ROOT }],
    });
    await expect(waitForTerminal(cancelling, cancelled.handleId)).resolves.toMatchObject({
      state: 'cancelled',
    });
  });

  it('keeps an incomplete cached closure staged until network fills its missing leaf', async () => {
    const http = fixtureHttp();
    const dbPath = join(await mkdtemp(join(tmpdir(), 'mibbeacon-partial-cache-')), 'mibbeacon.db');
    const engine = createEngine(transportWith(http), { dbPath });
    await enableResolver(engine);
    await engine.resolver.sources.create(sourceDraft());
    const seed = await engine.mibs.startImport({ files: [{ name: 'root.mib', content: ROOT }] });
    await waitForState(engine, seed.handleId, 'awaiting-consent');
    await engine.resolver.respondConsent(seed.handleId, { allow: true, askAgain: true });
    await waitForTerminal(engine, seed.handleId);
    await engine.mibs.unload('ROOT-MIB');
    await engine.mibs.unload('DEPENDENCY-MIB');
    await engine.mibs.unload('LEAF-MIB');
    // Keep cached parent but remove cached leaf so the second run is mixed cache/network.
    const db = nodeStorageFactory.open(dbPath);
    db.run("DELETE FROM resolver_cache WHERE module = 'LEAF-MIB'");
    db.close();
    const second = await engine.mibs.startImport({
      files: [{ name: 'second.mib', content: SECOND_ROOT }],
    });
    await waitForState(engine, second.handleId, 'awaiting-consent');
    await engine.resolver.respondConsent(second.handleId, { allow: true, askAgain: true });
    await expect(waitForTerminal(engine, second.handleId)).resolves.toMatchObject({
      state: 'done',
    });
  });

  it('rolls back the whole batch when a file is malformed after dependency resolution', async () => {
    const engine = createEngine(transportWith(fixtureHttp()), { dbPath: ':memory:' });
    await enableResolver(engine);
    await engine.resolver.sources.create(sourceDraft());
    const operation = await engine.mibs.startImport({
      files: [
        { name: 'broken.mib', content: 'BROKEN DEFINITIONS ::= BEGIN' },
        { name: 'root.mib', content: ROOT },
      ],
    });
    await waitForState(engine, operation.handleId, 'awaiting-consent');
    await engine.resolver.respondConsent(operation.handleId, { allow: true, askAgain: true });
    await expect(waitForTerminal(engine, operation.handleId)).resolves.toMatchObject({
      state: 'error',
      failures: expect.arrayContaining([
        expect.objectContaining({ message: expect.stringMatching(/module definition|END/i) }),
      ]),
    });
    expect(await engine.mibs.node('rootNode')).toBeNull();
    expect(await engine.mibs.node('dependencyNode')).toBeNull();
  });

  it('does not negative-cache a cancelled online OID lookup', async () => {
    const dbPath = join(await mkdtemp(join(tmpdir(), 'mibbeacon-cancel-lookup-')), 'mibbeacon.db');
    let blocking = true;
    const http: HttpClient & { fetch: ReturnType<typeof vi.fn> } = {
      fetch: vi.fn(async (request) => {
        if (blocking) {
          await new Promise<void>((_resolve, reject) => {
            request.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
              once: true,
            });
          });
        }
        return { status: 404, ok: false, headers: {}, text: '', bytes: 0 };
      }),
    };
    const engine = createEngine(transportWith(http), { dbPath });
    await enableResolver(engine);
    const first = await engine.resolver.lookupOid({ oid: '1.3.6.1.4.1.424242', network: true });
    await waitForState(engine, first.handleId, 'awaiting-consent');
    await engine.resolver.respondConsent(first.handleId, { allow: true, askAgain: false });
    await waitForState(engine, first.handleId, 'resolving');
    await engine.resolver.cancel(first.handleId);
    blocking = false;
    await expect(engine.resolver.status(first.handleId)).resolves.toMatchObject({
      state: 'cancelled',
    });
    const db = nodeStorageFactory.open(dbPath);
    expect(
      db.get<{ count: number }>('SELECT COUNT(*) AS count FROM resolver_lookup_cache')?.count,
    ).toBe(0);
    db.close();

    const callsBeforeRetry = http.fetch.mock.calls.length;
    const second = await engine.resolver.lookupOid({ oid: '1.3.6.1.4.1.424242', network: true });
    await expect(waitForTerminal(engine, second.handleId)).resolves.toMatchObject({
      state: 'done',
    });
    expect(http.fetch.mock.calls.length).toBeGreaterThan(callsBeforeRetry);
  });

  it('previews an unsaved JSON catalog through a consent-gated content-free operation', async () => {
    const entries = Array.from({ length: 25 }, (_, index) => ({
      name: `VENDOR-${index}-MIB`,
      file: `/mibs/VENDOR-${index}-MIB.mib`,
    }));
    const catalog = JSON.stringify({ mibs: entries });
    const http: HttpClient & { fetch: ReturnType<typeof vi.fn> } = {
      fetch: vi.fn(async () => ({
        status: 200,
        ok: true,
        headers: {},
        text: catalog,
        bytes: catalog.length,
      })),
    };
    const engine = createEngine(transportWith(http), { dbPath: ':memory:' });
    await enableResolver(engine);
    const before = await engine.resolver.sources.list();
    const preview = await engine.resolver.sources.preview({
      config: {
        id: 'unsaved-preview',
        kind: 'json-catalog',
        name: 'Preview',
        enabled: true,
        priority: 0,
        catalogUrl: 'https://catalog.example/catalog.json',
        urlQuery: '$.mibs[*].file',
        nameQuery: '$.mibs[*].name',
        authKind: 'none',
        passwordRef: 'agent:must-not-read',
      },
    });
    await waitForState(engine, preview.handleId, 'awaiting-consent');
    expect(http.fetch).not.toHaveBeenCalled();
    await engine.resolver.respondConsent(preview.handleId, { allow: true, askAgain: true });
    const status = await waitForTerminal(engine, preview.handleId);

    expect(status).toMatchObject({ state: 'done', result: { kind: 'source-preview' } });
    expect((status.result as { entries: unknown[] }).entries).toHaveLength(20);
    expect((status.result as { rawSnippet?: string }).rawSnippet).toBe(catalog.slice(0, 4_096));
    expect(await engine.resolver.sources.list()).toEqual(before);
    expect(http.fetch).toHaveBeenCalledTimes(1);
  });
});
