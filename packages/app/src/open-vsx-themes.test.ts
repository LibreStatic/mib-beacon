import { describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import {
  downloadOpenVsxTheme,
  searchOpenVsxThemes,
  type OpenVsxThemeListing,
} from './open-vsx-themes';

const jsonResponse = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('Open VSX theme catalog', () => {
  it('searches only the Themes category and returns licensed downloadable metadata', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes('/api/-/search')) {
        expect(url).toContain('category=Themes');
        return jsonResponse({
          extensions: [
            { namespace: 'licensed', name: 'night' },
            { namespace: 'missing', name: 'license' },
          ],
        });
      }
      if (url.endsWith('/api/licensed/night')) {
        return jsonResponse({
          namespace: 'licensed',
          name: 'night',
          displayName: 'Licensed Night',
          description: 'A theme',
          version: '1.0.0',
          license: 'MIT',
          verified: true,
          downloadCount: 42,
          downloadable: true,
          deprecated: false,
          categories: ['Themes'],
          files: {
            download: 'https://open-vsx.org/api/licensed/night/1.0.0/file/night.vsix',
          },
        });
      }
      return jsonResponse({
        namespace: 'missing',
        name: 'license',
        version: '1.0.0',
        license: '',
        downloadable: true,
        categories: ['Themes'],
        files: {
          download: 'https://open-vsx.org/api/missing/license/1.0.0/file/theme.vsix',
        },
      });
    });
    await expect(searchOpenVsxThemes('night', { fetcher })).resolves.toMatchObject([
      {
        id: 'licensed.night',
        displayName: 'Licensed Night',
        license: 'MIT',
        verified: true,
      },
    ]);
  });

  it('downloads a theme-only VSIX and records registry license provenance', async () => {
    const bytes = zipSync({
      'extension/package.json': strToU8(
        JSON.stringify({
          name: 'night',
          publisher: 'licensed',
          version: '1.0.0',
          license: 'SEE LICENSE',
          contributes: {
            themes: [{ label: 'Night', uiTheme: 'vs-dark', path: './theme.json' }],
          },
        }),
      ),
      'extension/theme.json': strToU8(
        JSON.stringify({
          colors: { 'editor.background': '#111111', foreground: '#eeeeee' },
        }),
      ),
      'extension/index.js': strToU8('throw new Error("never execute")'),
    });
    const listing: OpenVsxThemeListing = {
      id: 'licensed.night',
      namespace: 'licensed',
      name: 'night',
      displayName: 'Night',
      description: '',
      version: '1.0.0',
      license: 'MIT',
      verified: true,
      downloadCount: 42,
      downloadUrl: 'https://open-vsx.org/api/licensed/night/1.0.0/file/night.vsix',
      detailsUrl: 'https://open-vsx.org/extension/licensed/night',
    };
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(bytes, {
          status: 200,
          headers: { 'content-length': String(bytes.byteLength) },
        }),
    );
    const imported = await downloadOpenVsxTheme(listing, { fetcher });
    expect(imported.themes[0]).toMatchObject({
      label: 'Night',
      provenance: {
        kind: 'open-vsx',
        extensionId: 'licensed.night',
        version: '1.0.0',
        license: 'MIT',
      },
    });
  });

  it('rejects short searches, rate limits, foreign download URLs, and oversized downloads', async () => {
    await expect(searchOpenVsxThemes('x')).rejects.toThrow(/two characters/);
    await expect(
      searchOpenVsxThemes('night', {
        fetcher: async () => jsonResponse({}, 429),
      }),
    ).rejects.toThrow(/rate limit/);
    const listing = {
      id: 'bad.theme',
      namespace: 'bad',
      name: 'theme',
      displayName: 'Bad',
      description: '',
      version: '1',
      license: 'MIT',
      verified: false,
      downloadCount: 0,
      downloadUrl: 'https://evil.example/theme.vsix',
      detailsUrl: 'https://open-vsx.org/extension/bad/theme',
    };
    await expect(downloadOpenVsxTheme(listing)).rejects.toThrow(/untrusted/);
    await expect(
      downloadOpenVsxTheme(
        {
          ...listing,
          downloadUrl: 'https://open-vsx.org/api/bad/theme/file/theme.vsix',
        },
        {
          fetcher: async () =>
            new Response(new Uint8Array(), {
              status: 200,
              headers: { 'content-length': String(11 * 1024 * 1024) },
            }),
        },
      ),
    ).rejects.toThrow(/safety limit/);
  });

  it('stops an undeclared oversized download while streaming instead of buffering it first', async () => {
    const listing: OpenVsxThemeListing = {
      id: 'large.theme',
      namespace: 'large',
      name: 'theme',
      displayName: 'Large',
      description: '',
      version: '1',
      license: 'MIT',
      verified: false,
      downloadCount: 0,
      downloadUrl: 'https://open-vsx.org/api/large/theme/file/theme.vsix',
      detailsUrl: 'https://open-vsx.org/extension/large/theme',
    };
    const chunk = new Uint8Array(6 * 1024 * 1024);
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(chunk);
          controller.enqueue(chunk);
          controller.close();
        },
      }),
      { status: 200 },
    );
    response.arrayBuffer = vi.fn(async () => {
      throw new Error('must not buffer the whole response');
    });
    await expect(downloadOpenVsxTheme(listing, { fetcher: async () => response })).rejects.toThrow(
      /safety limit/,
    );
    expect(response.arrayBuffer).not.toHaveBeenCalled();
  });

  it('rejects a response without Content-Length when native streaming is unavailable', async () => {
    const listing: OpenVsxThemeListing = {
      id: 'native.theme',
      namespace: 'native',
      name: 'theme',
      displayName: 'Native',
      description: '',
      version: '1',
      license: 'MIT',
      verified: false,
      downloadCount: 0,
      downloadUrl: 'https://open-vsx.org/api/native/theme/file/theme.vsix',
      detailsUrl: 'https://open-vsx.org/extension/native/theme',
    };
    const arrayBuffer = vi.fn(async () => {
      throw new Error('must not buffer an unbounded response');
    });
    const response = {
      ok: true,
      status: 200,
      url: listing.downloadUrl,
      headers: new Headers(),
      body: null,
      arrayBuffer,
    } as unknown as Response;
    await expect(downloadOpenVsxTheme(listing, { fetcher: async () => response })).rejects.toThrow(
      /Content-Length/,
    );
    expect(arrayBuffer).not.toHaveBeenCalled();
  });
});
