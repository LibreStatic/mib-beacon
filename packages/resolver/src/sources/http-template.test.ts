import { describe, expect, it } from 'vitest';

import type { HttpClient, HttpRequest, HttpResponse } from '@mibbeacon/transport';

import { HttpTemplateSource } from './http-template';
import type { HttpTemplateSourceConfig } from './types';

class FixtureHttpClient implements HttpClient {
  readonly requests: HttpRequest[] = [];

  constructor(private readonly responses: Record<string, Partial<HttpResponse>>) {}

  async fetch(request: HttpRequest): Promise<HttpResponse> {
    this.requests.push(request);
    const response = this.responses[request.url];
    if (!response) return { status: 404, ok: false, headers: {}, text: '', bytes: 0 };
    return { status: 200, ok: true, headers: {}, text: '', bytes: 0, ...response };
  }
}

const BASE_CONFIG: HttpTemplateSourceConfig = {
  id: 'fixture',
  kind: 'http-template',
  name: 'Fixture',
  enabled: true,
  priority: 1,
  urlTemplate: 'https://mibs.example/raw/@mib@',
  authKind: 'none',
};

describe('HttpTemplateSource', () => {
  it('probes filename variants until validated MIB content is found', async () => {
    const html = '<html>soft miss</html>';
    const good = 'IF-MIB DEFINITIONS ::= BEGIN\nEND';
    const http = new FixtureHttpClient({
      'https://mibs.example/raw/IF-MIB': { text: html, bytes: html.length },
      'https://mibs.example/raw/IF-MIB.txt': { text: good, bytes: good.length },
    });

    const source = new HttpTemplateSource(BASE_CONFIG, http);
    await expect(source.fetch('IF-MIB')).resolves.toMatchObject({
      status: 'found',
      module: 'IF-MIB',
      content: good,
      sourceId: 'fixture',
      location: 'https://mibs.example/raw/IF-MIB.txt',
    });
    expect(http.requests.map(({ url }) => url)).toEqual([
      'https://mibs.example/raw/IF-MIB',
      'https://mibs.example/raw/IF-MIB.txt',
    ]);
    expect(http.requests[0]).toMatchObject({ timeoutMs: 15_000, maxBytes: 5 * 1024 * 1024 });
  });

  it('appends variants when the template omits the placeholder', async () => {
    const good = 'IF-MIB DEFINITIONS ::= BEGIN\nEND';
    const http = new FixtureHttpClient({
      'https://mibs.example/raw/IF-MIB.my': { text: good, bytes: good.length },
    });
    const source = new HttpTemplateSource(
      { ...BASE_CONFIG, urlTemplate: 'https://mibs.example/raw/', fixedExtension: '.my' },
      http,
    );

    await expect(source.fetch('IF-MIB')).resolves.toMatchObject({ status: 'found' });
    expect(http.requests[0]?.url).toBe('https://mibs.example/raw/IF-MIB.my');
  });

  it('adds custom headers and resolved basic authentication', async () => {
    const good = 'PRIVATE-MIB DEFINITIONS ::= BEGIN\nEND';
    const http = new FixtureHttpClient({
      'https://mibs.example/raw/PRIVATE-MIB': { text: good, bytes: good.length },
    });
    const source = new HttpTemplateSource(
      {
        ...BASE_CONFIG,
        authKind: 'basic',
        username: 'reader',
        passwordRef: 'secret-1',
        headers: { 'X-Repository': 'private' },
      },
      http,
      async (ref) => (ref === 'secret-1' ? 'p@ss' : null),
    );

    await source.fetch('PRIVATE-MIB');
    expect(http.requests[0]?.headers).toEqual({
      'X-Repository': 'private',
      Authorization: 'Basic cmVhZGVyOnBAc3M=',
    });
  });

  it('returns not-found after all bounded candidates miss', async () => {
    const http = new FixtureHttpClient({});
    const source = new HttpTemplateSource(BASE_CONFIG, http);
    await expect(source.fetch('NO-MIB')).resolves.toEqual({
      status: 'not-found',
      module: 'NO-MIB',
      sourceId: 'fixture',
    });
    expect(http.requests).toHaveLength(14);
  });

  it('propagates the abort signal to each HTTP probe', async () => {
    const controller = new AbortController();
    const http = new FixtureHttpClient({});
    const source = new HttpTemplateSource(BASE_CONFIG, http);

    await source.fetch('NO-MIB', { signal: controller.signal });

    expect(
      (http.requests[0] as HttpRequest & { signal?: AbortSignal } | undefined)?.signal,
    ).toBe(controller.signal);
  });

  it.each([403, 429])('stops probing on HTTP %s and returns retry metadata', async (status) => {
    const http = new FixtureHttpClient({
      'https://mibs.example/raw/IF-MIB': {
        status,
        ok: false,
        headers: { 'retry-after': '3' },
      },
    });
    const source = new HttpTemplateSource(BASE_CONFIG, http);

    await expect(source.fetch('IF-MIB')).resolves.toEqual({
      status: 'not-found',
      module: 'IF-MIB',
      sourceId: 'fixture',
      httpStatus: status,
      retryAfterMs: 3_000,
      reason: `HTTP ${status}`,
    });
    expect(http.requests).toHaveLength(1);
  });
});
