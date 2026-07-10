import type { HttpClient, HttpRequest, HttpResponse } from '../types';
import { USER_AGENT } from '../types';

const DEFAULT_TIMEOUT = 15_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

export const nodeHttpClient: HttpClient = {
  async fetch(req: HttpRequest): Promise<HttpResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), req.timeoutMs ?? DEFAULT_TIMEOUT);
    try {
      const res = await fetch(req.url, {
        method: req.method ?? 'GET',
        headers: { 'User-Agent': USER_AGENT, ...req.headers },
        body: req.body,
        signal: controller.signal,
      });

      const maxBytes = req.maxBytes ?? DEFAULT_MAX_BYTES;
      const buf = await readCapped(res, maxBytes);
      const text = new TextDecoder().decode(buf);

      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => (headers[k] = v));

      return { status: res.status, ok: res.ok, headers, text, bytes: buf.byteLength };
    } finally {
      clearTimeout(timeout);
    }
  },
};

async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  if (!res.body) {
    const ab = await res.arrayBuffer();
    if (ab.byteLength > maxBytes) throw new Error(`response exceeds ${maxBytes} bytes`);
    return new Uint8Array(ab);
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`response exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}
