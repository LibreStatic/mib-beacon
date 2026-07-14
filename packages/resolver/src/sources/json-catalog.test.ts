import { describe, expect, it } from 'vitest';

import type { HttpClient, HttpRequest, HttpResponse } from '@mibbeacon/transport';

import { evaluateSimpleJsonPath, JsonCatalogSource } from './json-catalog';
import type { JsonCatalogSourceConfig } from './types';

class FixtureHttpClient implements HttpClient {
  readonly requests: HttpRequest[] = [];
  constructor(private readonly responses: Record<string, Partial<HttpResponse>>) {}
  async fetch(request: HttpRequest): Promise<HttpResponse> {
    this.requests.push(request);
    const response = this.responses[request.url];
    return { status: 404, ok: false, headers: {}, text: '', bytes: 0, ...response };
  }
}

describe('evaluateSimpleJsonPath', () => {
  it('evaluates property, wildcard, bracket-property, and array-index segments', () => {
    const data = {
      catalogs: [{ files: [{ name: 'IF-MIB' }] }, { files: [{ name: 'SNMPv2-MIB' }] }],
    };
    expect(evaluateSimpleJsonPath(data, "$.catalogs[*]['files'][0].name")).toEqual([
      'IF-MIB',
      'SNMPv2-MIB',
    ]);
  });

  it('rejects filters and recursive descent', () => {
    expect(() => evaluateSimpleJsonPath({}, '$..files')).toThrow(/Unsupported JSONPath/);
    expect(() => evaluateSimpleJsonPath({}, '$[?(@.name)]')).toThrow(/Unsupported JSONPath/);
  });
});

const CONFIG: JsonCatalogSourceConfig = {
  id: 'json',
  kind: 'json-catalog',
  name: 'JSON fixture',
  enabled: true,
  priority: 1,
  catalogUrl: 'https://catalog.example/catalog.json',
  urlQuery: '$.mibs[*].file',
  nameQuery: '$.mibs[*].name',
  authKind: 'none',
};

describe('JsonCatalogSource', () => {
  it('single-flights concurrent catalog refreshes and persists its index', async () => {
    const catalog = JSON.stringify({ mibs: [{ name: 'IF-MIB', file: '/IF-MIB.mib' }] });
    const http = new FixtureHttpClient({
      [CONFIG.catalogUrl]: { status: 200, ok: true, text: catalog, headers: { etag: 'catalog-v1' } },
    });
    const saved: unknown[] = [];
    const store = { load: async () => null, save: async (snapshot: unknown) => { saved.push(snapshot); } };
    const source = new JsonCatalogSource(CONFIG, http, undefined, Date.now, store);

    await Promise.all([source.fetch('MISSING-A'), source.fetch('MISSING-B')]);

    expect(http.requests.filter(({ url }) => url === CONFIG.catalogUrl)).toHaveLength(1);
    expect(saved).toEqual([expect.objectContaining({ etag: 'catalog-v1', entries: expect.any(Object) })]);
  });

  it('persists a new refreshedAt when a conditional refresh returns 304', async () => {
    let saved: unknown;
    const http = new FixtureHttpClient({
      [CONFIG.catalogUrl]: { status: 304, ok: false, headers: {} },
    });
    const store = {
      load: async () => ({ entries: { 'IF-MIB': '/IF-MIB.mib' }, etag: 'v1', refreshedAt: 0 }),
      save: async (snapshot: unknown) => { saved = snapshot; },
    };
    const source = new JsonCatalogSource({ ...CONFIG, refreshDays: 1 }, http, undefined, () => 2 * 86_400_000, store);

    await source.fetch('MISSING');

    expect(saved).toEqual(expect.objectContaining({ etag: 'v1', refreshedAt: 2 * 86_400_000 }));
  });
  it('does not forward catalog credentials to cross-origin content URLs', async () => {
    const contentUrl = 'https://attacker.example/IF-MIB.mib';
    const catalog = JSON.stringify({ mibs: [{ name: 'IF-MIB', file: contentUrl }] });
    const http = new FixtureHttpClient({
      [CONFIG.catalogUrl]: { status: 200, ok: true, text: catalog },
      [contentUrl]: {
        status: 200,
        ok: true,
        text: 'IF-MIB DEFINITIONS ::= BEGIN\nEND',
      },
    });
    const source = new JsonCatalogSource(
      {
        ...CONFIG,
        authKind: 'basic',
        username: 'catalog-user',
        passwordRef: 'catalog-password',
        headers: { 'X-Catalog-Key': 'catalog-secret' },
      },
      http,
      async () => 'password',
    );

    await expect(source.fetch('IF-MIB')).resolves.toMatchObject({ status: 'found' });

    expect(http.requests).toHaveLength(2);
    expect(http.requests[0]?.headers).toEqual({
      'X-Catalog-Key': 'catalog-secret',
      Authorization: 'Basic Y2F0YWxvZy11c2VyOnBhc3N3b3Jk',
    });
    expect(http.requests[1]?.headers).toBeUndefined();
  });

  it('forwards catalog credentials to same-origin content URLs', async () => {
    const contentUrl = 'https://catalog.example/IF-MIB.mib';
    const http = new FixtureHttpClient({
      [CONFIG.catalogUrl]: {
        status: 200,
        ok: true,
        text: JSON.stringify({ mibs: [{ name: 'IF-MIB', file: contentUrl }] }),
      },
      [contentUrl]: {
        status: 200,
        ok: true,
        text: 'IF-MIB DEFINITIONS ::= BEGIN\nEND',
      },
    });
    const source = new JsonCatalogSource(
      {
        ...CONFIG,
        authKind: 'basic',
        username: 'catalog-user',
        passwordRef: 'catalog-password',
        headers: { 'X-Catalog-Key': 'catalog-secret' },
      },
      http,
      async () => 'password',
    );

    await source.fetch('IF-MIB');

    expect(http.requests[1]?.headers).toEqual(http.requests[0]?.headers);
  });

  it('indexes named relative URLs and reuses the catalog', async () => {
    const catalog = JSON.stringify({ mibs: [{ name: 'IF-MIB', file: './raw/IF-MIB.txt' }] });
    const content = 'IF-MIB DEFINITIONS ::= BEGIN\nEND';
    const rawUrl = 'https://catalog.example/raw/IF-MIB.txt';
    const http = new FixtureHttpClient({
      [CONFIG.catalogUrl]: { status: 200, ok: true, text: catalog },
      [rawUrl]: { status: 200, ok: true, text: content },
    });
    const source = new JsonCatalogSource(CONFIG, http);

    await expect(source.fetch('if-mib')).resolves.toMatchObject({
      status: 'found',
      module: 'if-mib',
      content,
      location: rawUrl,
    });
    await source.fetch('MISSING-MIB');
    expect(http.requests.filter(({ url }) => url === CONFIG.catalogUrl)).toHaveLength(1);
  });

  it('derives names from URL basenames when nameQuery is omitted', async () => {
    const catalog = JSON.stringify({ files: ['/mibs/SNMPv2-MIB.mib'] });
    const content = 'SNMPv2-MIB DEFINITIONS ::= BEGIN\nEND';
    const http = new FixtureHttpClient({
      [CONFIG.catalogUrl]: { status: 200, ok: true, text: catalog },
      'https://catalog.example/mibs/SNMPv2-MIB.mib': { status: 200, ok: true, text: content },
    });
    const source = new JsonCatalogSource(
      { ...CONFIG, urlQuery: '$.files[*]', nameQuery: undefined },
      http,
    );

    await expect(source.fetch('SNMPv2-MIB')).resolves.toMatchObject({ status: 'found' });
  });

  it('rejects mismatched name and URL query cardinality', async () => {
    const catalog = JSON.stringify({
      mibs: [
        { name: 'ONE', file: '/one' },
        { name: 'TWO', file: '/two' },
      ],
    });
    const http = new FixtureHttpClient({
      [CONFIG.catalogUrl]: { status: 200, ok: true, text: catalog },
    });
    const source = new JsonCatalogSource({ ...CONFIG, nameQuery: '$.mibs[0].name' }, http);

    await expect(source.fetch('ONE')).rejects.toThrow(/same number of values/);
  });

  it('propagates the abort signal through catalog and content requests', async () => {
    const catalog = JSON.stringify({ mibs: [{ name: 'IF-MIB', file: '/IF-MIB.mib' }] });
    const content = 'IF-MIB DEFINITIONS ::= BEGIN\nEND';
    const http = new FixtureHttpClient({
      [CONFIG.catalogUrl]: { status: 200, ok: true, text: catalog },
      'https://catalog.example/IF-MIB.mib': { status: 200, ok: true, text: content },
    });
    const controller = new AbortController();
    const source = new JsonCatalogSource(CONFIG, http);

    await source.fetch('IF-MIB', { signal: controller.signal });

    expect(http.requests).toHaveLength(2);
    expect(
      http.requests.every(
        (request) =>
          (request as HttpRequest & { signal?: AbortSignal }).signal === controller.signal,
      ),
    ).toBe(true);
  });

  it('refreshes an initialized catalog after refreshDays elapses', async () => {
    const dayMs = 24 * 60 * 60 * 1_000;
    let now = 0;
    const responses: Record<string, Partial<HttpResponse>> = {
      [CONFIG.catalogUrl]: {
        status: 200,
        ok: true,
        text: JSON.stringify({ mibs: [{ name: 'IF-MIB', file: '/IF-MIB.mib' }] }),
      },
      'https://catalog.example/IF-MIB.mib': {
        status: 200,
        ok: true,
        text: 'IF-MIB DEFINITIONS ::= BEGIN\nEND',
      },
      'https://catalog.example/NEW-MIB.mib': {
        status: 200,
        ok: true,
        text: 'NEW-MIB DEFINITIONS ::= BEGIN\nEND',
      },
    };
    const http = new FixtureHttpClient(responses);
    const source = new JsonCatalogSource({ ...CONFIG, refreshDays: 2 }, http, undefined, () => now);

    await expect(source.fetch('IF-MIB')).resolves.toMatchObject({ status: 'found' });
    responses[CONFIG.catalogUrl] = {
      status: 200,
      ok: true,
      text: JSON.stringify({ mibs: [{ name: 'NEW-MIB', file: '/NEW-MIB.mib' }] }),
    };
    now = dayMs;
    await expect(source.fetch('NEW-MIB')).resolves.toMatchObject({ status: 'not-found' });
    now = 2 * dayMs;
    await expect(source.fetch('NEW-MIB')).resolves.toMatchObject({ status: 'found' });
    expect(http.requests.filter(({ url }) => url === CONFIG.catalogUrl)).toHaveLength(2);
  });

  it.each([401, 403, 429])('returns HTTP %s catalog failures as retry metadata', async (status) => {
    const http = new FixtureHttpClient({
      [CONFIG.catalogUrl]: { status, ok: false, headers: { 'retry-after': '5' } },
    });
    const source = new JsonCatalogSource(CONFIG, http);

    await expect(source.fetch('IF-MIB')).resolves.toEqual({
      status: 'not-found',
      module: 'IF-MIB',
      sourceId: 'json',
      httpStatus: status,
      retryAfterMs: 5_000,
      reason: `HTTP ${status}`,
    });
    expect(http.requests).toHaveLength(1);
  });

  it('returns retry metadata for rate-limited catalog content', async () => {
    const catalog = JSON.stringify({ mibs: [{ name: 'IF-MIB', file: '/IF-MIB.mib' }] });
    const http = new FixtureHttpClient({
      [CONFIG.catalogUrl]: { status: 200, ok: true, text: catalog },
      'https://catalog.example/IF-MIB.mib': {
        status: 429,
        ok: false,
        headers: { 'retry-after': '6' },
      },
    });
    const source = new JsonCatalogSource(CONFIG, http);

    await expect(source.fetch('IF-MIB')).resolves.toMatchObject({
      status: 'not-found',
      httpStatus: 429,
      retryAfterMs: 6_000,
      reason: 'HTTP 429',
    });
  });
});
