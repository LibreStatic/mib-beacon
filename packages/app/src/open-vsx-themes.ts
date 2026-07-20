import type { ThemeDescriptor } from '@mibbeacon/ui/theme-values';
import { THEME_IMPORT_LIMITS, importVscodeThemeVsix } from './theme-import';

const OPEN_VSX_ORIGIN = 'https://open-vsx.org';
const OPEN_VSX_CONTENT_ORIGIN = 'https://openvsx.eclipsecontent.org';
const OPEN_VSX_API = `${OPEN_VSX_ORIGIN}/api`;

export interface OpenVsxThemeListing {
  id: string;
  namespace: string;
  name: string;
  displayName: string;
  description: string;
  version: string;
  license: string;
  verified: boolean;
  downloadCount: number;
  downloadUrl: string;
  detailsUrl: string;
  iconUrl?: string;
}

interface SearchExtension {
  namespace?: unknown;
  name?: unknown;
}

interface SearchResponse {
  extensions?: unknown;
}

interface ExtensionMetadata {
  namespace?: unknown;
  name?: unknown;
  displayName?: unknown;
  description?: unknown;
  version?: unknown;
  license?: unknown;
  verified?: unknown;
  downloadCount?: unknown;
  downloadable?: unknown;
  deprecated?: unknown;
  categories?: unknown;
  files?: {
    download?: unknown;
    icon?: unknown;
  };
}

function shortText(value: unknown, fallback = '', maximum = 500): string {
  return typeof value === 'string' && value.length <= maximum ? value : fallback;
}

function safeOpenVsxUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return url.origin === OPEN_VSX_ORIGIN && url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

async function openVsxJson(
  url: string,
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetcher(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!response.ok) {
    if (response.status === 429) throw new Error('Open VSX rate limit reached. Try again later.');
    throw new Error(`Open VSX request failed (${response.status}).`);
  }
  return response.json() as Promise<unknown>;
}

export async function searchOpenVsxThemes(
  query: string,
  options: { fetcher?: typeof fetch; signal?: AbortSignal; limit?: number } = {},
): Promise<OpenVsxThemeListing[]> {
  const normalized = query.trim().slice(0, 100);
  if (normalized.length < 2) throw new Error('Enter at least two characters to search themes.');
  const fetcher = options.fetcher ?? fetch;
  const limit = Math.min(Math.max(options.limit ?? 12, 1), 20);
  const params = new URLSearchParams({
    query: normalized,
    category: 'Themes',
    size: String(limit),
    sortBy: 'relevance',
    sortOrder: 'desc',
  });
  const search = (await openVsxJson(
    `${OPEN_VSX_API}/-/search?${params.toString()}`,
    fetcher,
    options.signal,
  )) as SearchResponse;
  if (!Array.isArray(search.extensions))
    throw new Error('Open VSX returned an invalid search response.');

  const metadata = await Promise.all(
    search.extensions.slice(0, limit).map(async (candidate: SearchExtension) => {
      const namespace = shortText(candidate?.namespace, '', 100);
      const name = shortText(candidate?.name, '', 100);
      if (!/^[a-z\d][a-z\d._-]*$/i.test(namespace) || !/^[a-z\d][a-z\d._-]*$/i.test(name)) {
        return undefined;
      }
      return (await openVsxJson(
        `${OPEN_VSX_API}/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
        fetcher,
        options.signal,
      )) as ExtensionMetadata;
    }),
  );

  return metadata.flatMap((item): OpenVsxThemeListing[] => {
    if (!item || item.deprecated === true || item.downloadable !== true) return [];
    if (!Array.isArray(item.categories) || !item.categories.includes('Themes')) return [];
    const namespace = shortText(item.namespace, '', 100);
    const name = shortText(item.name, '', 100);
    const version = shortText(item.version, '', 100);
    const license = shortText(item.license, '', 200);
    const downloadUrl = safeOpenVsxUrl(item.files?.download);
    if (!namespace || !name || !version || !license || !downloadUrl) return [];
    return [
      {
        id: `${namespace}.${name}`,
        namespace,
        name,
        displayName: shortText(item.displayName, name, 160),
        description: shortText(item.description, '', 500),
        version,
        license,
        verified: item.verified === true,
        downloadCount:
          typeof item.downloadCount === 'number' && Number.isFinite(item.downloadCount)
            ? Math.max(0, item.downloadCount)
            : 0,
        downloadUrl,
        detailsUrl: `${OPEN_VSX_ORIGIN}/extension/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
        iconUrl: safeOpenVsxUrl(item.files?.icon),
      },
    ];
  });
}

export async function downloadOpenVsxTheme(
  listing: OpenVsxThemeListing,
  options: { fetcher?: typeof fetch; signal?: AbortSignal } = {},
): Promise<{ themes: ThemeDescriptor[]; warnings: string[] }> {
  const downloadUrl = safeOpenVsxUrl(listing.downloadUrl);
  if (!downloadUrl) throw new Error('Refused an untrusted Open VSX download URL.');
  const response = await (options.fetcher ?? fetch)(downloadUrl, {
    method: 'GET',
    headers: { Accept: 'application/octet-stream' },
    signal: options.signal,
  });
  if (!response.ok) throw new Error(`Open VSX download failed (${response.status}).`);
  if (
    response.url &&
    ![OPEN_VSX_ORIGIN, OPEN_VSX_CONTENT_ORIGIN].includes(new URL(response.url).origin)
  ) {
    throw new Error('Refused an Open VSX download redirected to an untrusted host.');
  }
  const declaredLengthHeader = response.headers.get('content-length');
  const declaredLength =
    declaredLengthHeader == null || declaredLengthHeader.trim() === ''
      ? undefined
      : Number(declaredLengthHeader);
  if (
    declaredLength != null &&
    Number.isFinite(declaredLength) &&
    declaredLength > THEME_IMPORT_LIMITS.maxArchiveBytes
  ) {
    throw new Error('Open VSX theme exceeds the download safety limit.');
  }
  let bytes: Uint8Array;
  const reader = response.body?.getReader();
  if (reader) {
    const chunks: Uint8Array[] = [];
    let received = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > THEME_IMPORT_LIMITS.maxArchiveBytes) {
          await reader.cancel();
          throw new Error('Open VSX theme exceeds the download safety limit.');
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
  } else {
    if (declaredLength == null || !Number.isFinite(declaredLength) || declaredLength < 0) {
      throw new Error('Open VSX download requires Content-Length when streaming is unavailable.');
    }
    bytes = new Uint8Array(await response.arrayBuffer());
  }
  if (bytes.byteLength > THEME_IMPORT_LIMITS.maxArchiveBytes) {
    throw new Error('Open VSX theme exceeds the download safety limit.');
  }
  const imported = importVscodeThemeVsix({
    name: `${listing.id}-${listing.version}.vsix`,
    bytes,
  });
  return {
    themes: imported.themes.map((theme) => ({
      ...theme,
      provenance: {
        ...theme.provenance!,
        kind: 'open-vsx',
        extensionId: listing.id,
        version: listing.version,
        publisher: listing.namespace,
        license: listing.license,
      },
    })),
    warnings: imported.warnings,
  };
}
