import type { HttpClient, HttpRequest, HttpResponse } from '@mibbeacon/transport';

import type {
  HttpAuthConfig,
  HttpTemplateSourceConfig,
  MibSource,
  SecretResolver,
  SourceFetchContext,
  SourceFetchResult,
} from './types';
import { getMibFilenameVariants } from './variants';
import { DEFAULT_MIB_MAX_BYTES, validateMibContent } from './validator';

const DEFAULT_TIMEOUT_MS = 15_000;

export class HttpTemplateSource implements MibSource {
  readonly id: string;
  readonly kind = 'http-template' as const;
  readonly name: string;
  readonly enabled: boolean;
  readonly priority: number;
  readonly hosts: string[];

  constructor(
    private readonly config: HttpTemplateSourceConfig,
    private readonly http: HttpClient,
    private readonly resolveSecret?: SecretResolver,
  ) {
    this.id = config.id;
    this.name = config.name;
    this.enabled = config.enabled;
    this.priority = config.priority;
    this.hosts = hostOfTemplate(config.urlTemplate);
  }

  async fetch(module: string, context: SourceFetchContext = {}): Promise<SourceFetchResult> {
    if (this.config.modulePattern && !new RegExp(this.config.modulePattern, 'i').test(module)) {
      return this.notFound(module);
    }

    const headers = await buildHttpHeaders(this.config, this.resolveSecret);
    for (const filename of getMibFilenameVariants(module, this.config.fixedExtension)) {
      const url = expandUrlTemplate(this.config.urlTemplate, filename, module);
      const request: HttpRequest & { signal?: AbortSignal } = {
        url,
        method: 'GET',
        headers,
        timeoutMs: DEFAULT_TIMEOUT_MS,
        maxBytes: DEFAULT_MIB_MAX_BYTES,
        signal: context.signal,
      };
      const response = await this.http.fetch(request);
      if (response.status === 403 || response.status === 429) {
        return this.notFound(module, response);
      }
      if (!response.ok) continue;

      const validation = validateMibContent(module, response.text);
      if (!validation.ok) continue;
      return {
        status: 'found',
        module,
        content: response.text,
        sourceId: this.id,
        location: url,
        moduleName: validation.moduleName,
        warnings: validation.warnings,
      };
    }
    return this.notFound(module);
  }

  private notFound(module: string, response?: HttpResponse): SourceFetchResult {
    if (!response) return { status: 'not-found', module, sourceId: this.id };
    const retryAfterMs = parseRetryAfterMs(response.headers);
    return {
      status: 'not-found',
      module,
      sourceId: this.id,
      httpStatus: response.status,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      reason: `HTTP ${response.status}`,
    };
  }
}

export function parseRetryAfterMs(
  headers: Record<string, string>,
  now = Date.now(),
): number | undefined {
  const value = Object.entries(headers).find(([name]) => name.toLowerCase() === 'retry-after')?.[1]?.trim();
  if (!value) return undefined;
  if (/^\d+(?:\.\d+)?$/.test(value)) return Math.max(0, Number(value) * 1_000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

export function expandUrlTemplate(template: string, filename: string, moduleName = filename): string {
  const encodedFilename = encodeURIComponent(filename);
  const first = encodeURIComponent(moduleName.charAt(0).toUpperCase());
  if (template.includes('@mib@')) {
    return template.replaceAll('@mib@', encodedFilename).replaceAll('@first@', first);
  }
  return `${template}${encodedFilename}`.replaceAll('@first@', first);
}

export async function buildHttpHeaders(
  config: HttpAuthConfig,
  resolveSecret?: SecretResolver,
): Promise<Record<string, string> | undefined> {
  const headers = { ...config.headers };
  for (const [name, reference] of Object.entries(config.secretHeaders ?? {})) {
    if (!resolveSecret) throw new Error(`Secret header ${name} requires a secret resolver`);
    const value = await resolveSecret(reference);
    if (value === null) throw new Error(`Secret not found: ${reference}`);
    headers[name] = value;
  }
  if (config.authKind === 'basic') {
    if (!config.username || !config.passwordRef || !resolveSecret) {
      throw new Error('Basic authentication requires username, passwordRef, and a secret resolver');
    }
    const password = await resolveSecret(config.passwordRef);
    if (password === null) throw new Error(`Secret not found: ${config.passwordRef}`);
    headers.Authorization = `Basic ${base64(`${config.username}:${password}`)}`;
  }
  return Object.keys(headers).length ? headers : undefined;
}

function hostOfTemplate(template: string): string[] {
  try {
    return [new URL(template.replaceAll('@mib@', 'module').replaceAll('@first@', 'M')).host];
  } catch {
    return [];
  }
}

function base64(value: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes = new TextEncoder().encode(value);
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const bits = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    output += alphabet[(bits >>> 18) & 63];
    output += alphabet[(bits >>> 12) & 63];
    output += second === undefined ? '=' : alphabet[(bits >>> 6) & 63];
    output += third === undefined ? '=' : alphabet[bits & 63];
  }
  return output;
}
