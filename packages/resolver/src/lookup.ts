import type { HttpClient } from '@mibbeacon/transport';

export interface IanaEnterpriseRecord {
  number: number;
  organization: string;
  contact?: string;
  email?: string;
}

export interface OidBaseRecord {
  oid?: string;
  asn1Notation?: string;
  description?: string;
  lastModified?: string;
}

export interface OidRefRecord {
  title?: string;
  description?: string;
}

export const IANA_ENTERPRISE_NUMBERS_URL = 'https://www.iana.org/assignments/enterprise-numbers.txt';

export function parseIanaEnterpriseNumbers(text: string): IanaEnterpriseRecord[] {
  const records: IanaEnterpriseRecord[] = [];
  let number: number | undefined;
  let details: string[] = [];

  const flush = (): void => {
    if (number === undefined || !details[0]) return;
    const [organization, ...remaining] = details;
    const emailIndex = remaining.findIndex((line) => /^\S+(?:@|&)\S+$/.test(line));
    const email = emailIndex >= 0 ? remaining[emailIndex]?.replace('&', '@') : undefined;
    const contact = remaining.find((_, index) => index !== emailIndex);
    records.push({
      number,
      organization,
      ...(contact ? { contact } : {}),
      ...(email ? { email } : {}),
    });
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const numbered = /^(\d+)\s*$/.exec(rawLine);
    if (numbered?.[1]) {
      flush();
      number = Number(numbered[1]);
      details = [];
      continue;
    }
    if (number !== undefined && /^\s+\S/.test(rawLine)) details.push(rawLine.trim());
  }
  flush();
  return records;
}

export function enterpriseNumberFromOid(oid: string): number | null {
  const normalized = oid.startsWith('.') ? oid.slice(1) : oid;
  const match = /^1\.3\.6\.1\.4\.1\.(\d+)(?:\.|$)/.exec(normalized);
  return match?.[1] ? Number(match[1]) : null;
}

export class IanaEnterpriseClient {
  constructor(private readonly http: HttpClient) {}

  async fetchRegistry(signal?: AbortSignal): Promise<IanaEnterpriseRecord[]> {
    const response = await this.http.fetch({
      url: IANA_ENTERPRISE_NUMBERS_URL,
      method: 'GET',
      timeoutMs: 15_000,
      maxBytes: 5_000_000,
      signal,
    });
    if (!response.ok) throw new Error(`IANA enterprise registry request failed (${response.status})`);
    return parseIanaEnterpriseNumbers(response.text);
  }

  async lookupOid(oid: string, signal?: AbortSignal): Promise<IanaEnterpriseRecord | null> {
    const number = enterpriseNumberFromOid(oid);
    if (number === null) return null;
    return (await this.fetchRegistry(signal)).find((record) => record.number === number) ?? null;
  }
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFrontmatter(markdown: string): Record<string, string> {
  const match = /^\s*---\s*\r?\n([\s\S]*?)\r?\n---(?:\s|$)/.exec(markdown);
  if (!match?.[1]) return {};
  const result: Record<string, string> = {};
  const lines = match[1].split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) continue;
    const field = /^([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/.exec(line);
    if (!field?.[1] || field[2] === undefined) continue;
    const key = field[1];
    if (field[2] === '|' || field[2] === '>') {
      const values: string[] = [];
      while (index + 1 < lines.length && /^\s+/.test(lines[index + 1] ?? '')) {
        index += 1;
        values.push((lines[index] ?? '').replace(/^\s{1,2}/, ''));
      }
      result[key] = field[2] === '>' ? values.join(' ') : values.join('\n');
    } else {
      result[key] = unquote(field[2]);
    }
  }
  return result;
}

export function parseOidBaseMarkdown(markdown: string): OidBaseRecord | null {
  const fields = parseFrontmatter(markdown);
  const oid = fields['oid'];
  const asn1Notation = fields['asn1-notation'];
  const description = fields['description'];
  const lastModified = fields['last-modified'];
  if (!oid && !asn1Notation && !description && !lastModified) return null;
  return {
    ...(oid ? { oid } : {}),
    ...(asn1Notation ? { asn1Notation } : {}),
    ...(description ? { description } : {}),
    ...(lastModified ? { lastModified } : {}),
  };
}

function normalizeOid(oid: string): string {
  const normalized = oid.startsWith('.') ? oid.slice(1) : oid;
  if (!/^\d+(?:\.\d+)*$/.test(normalized)) throw new Error(`Invalid numeric OID: ${oid}`);
  return normalized;
}

export class OidBaseClient {
  constructor(private readonly http: HttpClient) {}

  async lookup(oid: string, signal?: AbortSignal): Promise<OidBaseRecord | null> {
    const response = await this.http.fetch({
      url: `https://oid-base.com/get-md/${normalizeOid(oid)}`,
      method: 'GET',
      timeoutMs: 15_000,
      maxBytes: 1_000_000,
      signal,
    });
    if (!response.ok) return null;
    return parseOidBaseMarkdown(response.text);
  }
}

const HTML_ENTITIES: Record<string, string> = {
  amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ',
};

function decodeHtml(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code.startsWith('#x')) return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    if (code.startsWith('#')) return String.fromCodePoint(Number(code.slice(1)));
    return HTML_ENTITIES[code.toLowerCase()] ?? entity;
  }).replace(/\s+/g, ' ').trim();
}

function metaDescription(html: string): string | undefined {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attributes: Record<string, string> = {};
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gs)) {
      if (match[1] && match[3] !== undefined) attributes[match[1].toLowerCase()] = match[3];
    }
    if (attributes['name']?.toLowerCase() === 'description' && attributes['content']) {
      return decodeHtml(attributes['content']);
    }
  }
  return undefined;
}

export function parseOidRefHtml(html: string): OidRefRecord | null {
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch?.[1] ? decodeHtml(titleMatch[1].replace(/<[^>]+>/g, ' ')) : undefined;
  const description = metaDescription(html);
  if (!title && !description) return null;
  return { ...(title ? { title } : {}), ...(description ? { description } : {}) };
}

export class OidRefClient {
  constructor(private readonly http: HttpClient) {}

  async lookup(oid: string, signal?: AbortSignal): Promise<OidRefRecord | null> {
    const response = await this.http.fetch({
      url: `https://oidref.com/${normalizeOid(oid)}`,
      method: 'GET',
      timeoutMs: 15_000,
      maxBytes: 1_000_000,
      signal,
    });
    if (!response.ok) return null;
    return parseOidRefHtml(response.text);
  }
}
