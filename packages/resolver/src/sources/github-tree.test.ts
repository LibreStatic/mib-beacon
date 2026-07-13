import { describe, expect, it } from 'vitest';

import type { HttpClient, HttpRequest, HttpResponse } from '@mibbeacon/transport';

import { GitHubTreeIndex, GitHubTreeSource } from './github-tree';
import type { GitHubTreeSourceConfig } from './types';

class FixtureHttpClient implements HttpClient {
  readonly requests: HttpRequest[] = [];
  constructor(private readonly responses: Record<string, Partial<HttpResponse>>) {}
  async fetch(request: HttpRequest): Promise<HttpResponse> {
    this.requests.push(request);
    const response = this.responses[request.url];
    return { status: 404, ok: false, headers: {}, text: '', bytes: 0, ...response };
  }
}

const CONFIG: GitHubTreeSourceConfig = {
  id: 'github',
  kind: 'github-tree',
  name: 'GitHub fixture',
  enabled: true,
  priority: 1,
  owner: 'acme',
  repo: 'mibs',
  branch: 'main',
  pathPrefix: 'vendor/',
};

const TREE_URL = 'https://api.github.com/repos/acme/mibs/git/trees/main?recursive=1';

describe('GitHubTreeIndex', () => {
  it('builds a case-insensitive module index and reuses it', async () => {
    const tree = JSON.stringify({
      tree: [
        { type: 'blob', path: 'vendor/cisco/CISCO-SMI.my' },
        { type: 'blob', path: 'outside/IF-MIB.txt' },
        { type: 'tree', path: 'vendor/cisco' },
      ],
    });
    const http = new FixtureHttpClient({ [TREE_URL]: { status: 200, ok: true, text: tree } });
    const index = new GitHubTreeIndex(CONFIG, http);

    await expect(index.find('cisco-smi')).resolves.toBe('vendor/cisco/CISCO-SMI.my');
    await expect(index.find('CISCO-SMI')).resolves.toBe('vendor/cisco/CISCO-SMI.my');
    await expect(index.find('IF-MIB')).resolves.toBeNull();
    expect(http.requests).toHaveLength(1);
  });

  it('single-flights concurrent refreshes and persists index metadata', async () => {
    const tree = JSON.stringify({ tree: [{ type: 'blob', path: 'vendor/IF-MIB.mib' }] });
    const http = new FixtureHttpClient({
      [TREE_URL]: { status: 200, ok: true, text: tree, headers: { etag: 'tree-v1' } },
    });
    const saved: unknown[] = [];
    const store = {
      load: async () => null,
      save: async (snapshot: unknown) => { saved.push(snapshot); },
    };
    const index = new GitHubTreeIndex(CONFIG, http, undefined, store);

    await Promise.all([index.find('IF-MIB'), index.find('IF-MIB')]);

    expect(http.requests).toHaveLength(1);
    expect(saved).toEqual([expect.objectContaining({ etag: 'tree-v1', entries: expect.any(Object) })]);
  });

  it('conditionally refreshes an expired persisted index using its ETag', async () => {
    const http = new FixtureHttpClient({
      [TREE_URL]: { status: 304, ok: false, headers: { etag: 'tree-v1' } },
    });
    const store = {
      load: async () => ({
        entries: { 'IF-MIB': 'vendor/IF-MIB.mib' },
        etag: 'tree-v1',
        refreshedAt: 0,
      }),
      save: async () => undefined,
    };
    const index = new GitHubTreeIndex({ ...CONFIG, refreshDays: 1 }, http, undefined, store, () => 2 * 86_400_000);

    await expect(index.find('IF-MIB')).resolves.toBe('vendor/IF-MIB.mib');
    expect(http.requests[0]?.headers).toMatchObject({ 'If-None-Match': 'tree-v1' });
  });
});

describe('GitHubTreeSource', () => {
  it('fetches and validates a raw file selected by its tree index', async () => {
    const tree = JSON.stringify({ tree: [{ type: 'blob', path: 'vendor/CISCO-SMI.my' }] });
    const content = 'CISCO-SMI DEFINITIONS ::= BEGIN\nEND';
    const rawUrl = 'https://raw.githubusercontent.com/acme/mibs/main/vendor/CISCO-SMI.my';
    const http = new FixtureHttpClient({
      [TREE_URL]: { status: 200, ok: true, text: tree },
      [rawUrl]: { status: 200, ok: true, text: content },
    });

    const source = new GitHubTreeSource(CONFIG, http);
    await expect(source.fetch('CISCO-SMI')).resolves.toMatchObject({
      status: 'found',
      module: 'CISCO-SMI',
      content,
      location: rawUrl,
      sourceId: 'github',
    });
  });

  it('sends the resolved token when fetching a private repository raw file', async () => {
    const tree = JSON.stringify({ tree: [{ type: 'blob', path: 'vendor/PRIVATE-MIB.my' }] });
    const content = 'PRIVATE-MIB DEFINITIONS ::= BEGIN\nEND';
    const rawUrl = 'https://raw.githubusercontent.com/acme/mibs/main/vendor/PRIVATE-MIB.my';
    const http = new FixtureHttpClient({
      [TREE_URL]: { status: 200, ok: true, text: tree },
      [rawUrl]: { status: 200, ok: true, text: content },
    });
    const source = new GitHubTreeSource(
      { ...CONFIG, tokenRef: 'github-token' },
      http,
      async () => 'secret-token',
    );

    await source.fetch('PRIVATE-MIB');

    expect(http.requests.at(-1)?.headers).toMatchObject({ Authorization: 'Bearer secret-token' });
  });

  it('propagates the abort signal through tree and raw requests', async () => {
    const tree = JSON.stringify({ tree: [{ type: 'blob', path: 'vendor/CISCO-SMI.my' }] });
    const content = 'CISCO-SMI DEFINITIONS ::= BEGIN\nEND';
    const rawUrl = 'https://raw.githubusercontent.com/acme/mibs/main/vendor/CISCO-SMI.my';
    const http = new FixtureHttpClient({
      [TREE_URL]: { status: 200, ok: true, text: tree },
      [rawUrl]: { status: 200, ok: true, text: content },
    });
    const controller = new AbortController();
    const source = new GitHubTreeSource(CONFIG, http);

    await source.fetch('CISCO-SMI', { signal: controller.signal });

    expect(http.requests).toHaveLength(2);
    expect(
      http.requests.every(
        (request) => (request as HttpRequest & { signal?: AbortSignal }).signal === controller.signal,
      ),
    ).toBe(true);
  });

  it.each([403, 429])('returns HTTP %s tree failures without fetching raw content', async (status) => {
    const http = new FixtureHttpClient({
      [TREE_URL]: { status, ok: false, headers: { 'Retry-After': '2' } },
    });
    const source = new GitHubTreeSource(CONFIG, http);

    await expect(source.fetch('CISCO-SMI')).resolves.toEqual({
      status: 'not-found',
      module: 'CISCO-SMI',
      sourceId: 'github',
      httpStatus: status,
      retryAfterMs: 2_000,
      reason: `HTTP ${status}`,
    });
    expect(http.requests).toHaveLength(1);
  });

  it('returns retry metadata for a rate-limited raw file request', async () => {
    const tree = JSON.stringify({ tree: [{ type: 'blob', path: 'vendor/CISCO-SMI.my' }] });
    const rawUrl = 'https://raw.githubusercontent.com/acme/mibs/main/vendor/CISCO-SMI.my';
    const http = new FixtureHttpClient({
      [TREE_URL]: { status: 200, ok: true, text: tree },
      [rawUrl]: { status: 429, ok: false, headers: { 'retry-after': '4' } },
    });
    const source = new GitHubTreeSource(CONFIG, http);

    await expect(source.fetch('CISCO-SMI')).resolves.toMatchObject({
      status: 'not-found',
      httpStatus: 429,
      retryAfterMs: 4_000,
      reason: 'HTTP 429',
    });
  });
});
