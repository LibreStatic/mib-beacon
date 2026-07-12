import type { TcpSocket, TcpSocketFactory } from '@omc/transport';
import type { FtpSourceConfig, MibSource, SecretResolver, SourceFetchResult } from './sources/types';
import { validateMibContent } from './sources/validator';

export type FtpSecurity = 'none' | 'ftps-explicit';

export interface FtpRetrieveRequest {
  host: string;
  port?: number;
  secure: FtpSecurity;
  username?: string;
  password?: string;
  path: string;
  timeoutMs?: number;
  maxBytes?: number;
  signal?: AbortSignal;
}

export interface FtpClient {
  retrieve(request: FtpRetrieveRequest): Promise<Uint8Array>;
}

const EXTENSIONS = ['', '.txt', '.mib', '.my', '.TXT', '.MIB', '.MY'] as const;

export function renderFtpPath(template: string, moduleVariant: string): string {
  return template.includes('@mib@')
    ? template.replaceAll('@mib@', moduleVariant)
    : `${template}${moduleVariant}`;
}

export function buildFtpPathCandidates(
  pathTemplate: string,
  moduleName: string,
  fixedExtension?: string,
): string[] {
  if (fixedExtension !== undefined) {
    return [renderFtpPath(pathTemplate, `${moduleName}${fixedExtension}`)];
  }
  const names = [...new Set([moduleName, moduleName.toUpperCase(), moduleName.toLowerCase()])];
  return names.flatMap((name) => EXTENSIONS.map((extension) => renderFtpPath(pathTemplate, `${name}${extension}`)));
}

interface FtpReply {
  code: number;
  message: string;
}

class FtpProtocolError extends Error {
  override readonly name = 'FtpProtocolError';

  constructor(
    readonly code: number,
    readonly stage: string,
    message: string,
  ) {
    super(`FTP ${stage} failed (${code}): ${message}`);
  }
}

class ControlReplies {
  private readonly pending: Array<(reply: FtpReply) => void> = [];
  private readonly replies: FtpReply[] = [];
  private buffer = '';
  private multilineCode: string | null = null;
  private multiline = '';

  constructor(socket: TcpSocket) {
    const decoder = new TextDecoder();
    socket.onData((data) => this.feed(decoder.decode(data, { stream: true })));
  }

  next(timeoutMs: number, signal?: AbortSignal): Promise<FtpReply> {
    const reply = this.replies.shift();
    if (reply) return Promise.resolve(reply);
    return withTimeout(new Promise<FtpReply>((resolve) => this.pending.push(resolve)), timeoutMs, 'FTP response timed out', signal);
  }

  private feed(text: string): void {
    this.buffer += text;
    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, '');
      this.buffer = this.buffer.slice(newline + 1);
      this.consumeLine(line);
      newline = this.buffer.indexOf('\n');
    }
  }

  private consumeLine(line: string): void {
    const match = /^(\d{3})([ -])(.*)$/.exec(line);
    if (!match) {
      if (this.multilineCode) this.multiline += `${line}\n`;
      return;
    }
    const [, code, separator, message] = match;
    if (!code || separator === undefined || message === undefined) return;
    if (!this.multilineCode && separator === '-') {
      this.multilineCode = code;
      this.multiline = `${message}\n`;
      return;
    }
    if (this.multilineCode) {
      this.multiline += message;
      if (code === this.multilineCode && separator === ' ') {
        this.deliver({ code: Number(code), message: this.multiline });
        this.multilineCode = null;
        this.multiline = '';
      }
      return;
    }
    this.deliver({ code: Number(code), message });
  }

  private deliver(reply: FtpReply): void {
    const waiter = this.pending.shift();
    if (waiter) waiter(reply);
    else this.replies.push(reply);
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(new Error('operation aborted')));
    const timer = setTimeout(() => finish(() => reject(new Error(message))), timeoutMs);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

function expectCode(reply: FtpReply, accepted: readonly number[], stage: string): void {
  if (!accepted.includes(reply.code)) {
    throw new FtpProtocolError(reply.code, stage, reply.message);
  }
}

function isFileUnavailable(error: unknown): boolean {
  return error instanceof FtpProtocolError
    && error.stage === 'retrieve'
    && (error.code === 450 || error.code === 550);
}

function parsePassivePort(message: string): number {
  const match = /\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/.exec(message);
  if (!match) throw new Error(`FTP PASV returned an invalid address: ${message}`);
  const high = Number(match[5]);
  const low = Number(match[6]);
  return high * 256 + low;
}

async function command(socket: TcpSocket, replies: ControlReplies, text: string, timeoutMs: number, signal?: AbortSignal): Promise<FtpReply> {
  await withTimeout(socket.write(new TextEncoder().encode(`${text}\r\n`)), timeoutMs, 'FTP write timed out', signal);
  return replies.next(timeoutMs, signal);
}

export class PassiveFtpClient implements FtpClient {
  constructor(private readonly sockets: TcpSocketFactory) {}

  async retrieve(request: FtpRetrieveRequest): Promise<Uint8Array> {
    if (/[\r\n]/.test(request.path)) throw new Error('invalid FTP path: newlines are not allowed');
    if (/[\r\n]/.test(request.username ?? '') || /[\r\n]/.test(request.password ?? '')) {
      throw new Error('invalid FTP credentials: newlines are not allowed');
    }
    const timeoutMs = request.timeoutMs ?? 15_000;
    const maxBytes = request.maxBytes ?? 5 * 1024 * 1024;
    const control = this.sockets.create();
    let data: TcpSocket | undefined;
    try {
      await withTimeout(control.connect(request.port ?? 21, request.host), timeoutMs, 'FTP connection timed out', request.signal);
      const replies = new ControlReplies(control);
      expectCode(await replies.next(timeoutMs, request.signal), [220], 'welcome');
      if (request.secure === 'ftps-explicit') {
        expectCode(await command(control, replies, 'AUTH TLS', timeoutMs, request.signal), [234], 'TLS authorization');
        await withTimeout(
          control.startTls({ serverName: request.host }),
          timeoutMs,
          'FTP TLS negotiation timed out',
          request.signal,
        );
        expectCode(await command(control, replies, 'PBSZ 0', timeoutMs, request.signal), [200], 'protection buffer size');
        expectCode(await command(control, replies, 'PROT P', timeoutMs, request.signal), [200], 'data protection');
      }
      const username = request.username ?? 'anonymous';
      const userReply = await command(control, replies, `USER ${username}`, timeoutMs, request.signal);
      if (userReply.code === 331) {
        const password = request.password ?? 'openmibcatalog@';
        expectCode(await command(control, replies, `PASS ${password}`, timeoutMs, request.signal), [230], 'login');
      } else {
        expectCode(userReply, [230], 'login');
      }
      expectCode(await command(control, replies, 'TYPE I', timeoutMs, request.signal), [200], 'binary mode');
      const passivePort = parsePassivePort((await command(control, replies, 'PASV', timeoutMs, request.signal)).message);
      data = this.sockets.create();
      const dataSocket = data;
      const chunks: Uint8Array[] = [];
      let size = 0;
      await withTimeout(dataSocket.connect(passivePort, request.host), timeoutMs, 'FTP data connection timed out', request.signal);
      if (request.secure === 'ftps-explicit') {
        await withTimeout(
          dataSocket.startTls({ serverName: request.host }),
          timeoutMs,
          'FTP data TLS negotiation timed out',
          request.signal,
        );
      }
      const closed = new Promise<void>((resolve, reject) => {
        dataSocket.onData((chunk) => {
          size += chunk.byteLength;
          if (size > maxBytes) reject(new Error(`FTP response exceeds ${maxBytes} bytes`));
          else chunks.push(chunk);
        });
        dataSocket.onError(reject);
        dataSocket.onClose(resolve);
      });
      expectCode(await command(control, replies, `RETR ${request.path}`, timeoutMs, request.signal), [125, 150], 'retrieve');
      await withTimeout(closed, timeoutMs, 'FTP data transfer timed out', request.signal);
      expectCode(await replies.next(timeoutMs, request.signal), [226, 250], 'transfer completion');
      await command(control, replies, 'QUIT', timeoutMs, request.signal).catch(() => undefined);
      await dataSocket.end();
      data = undefined;
      const result = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
      return result;
    } finally {
      await data?.end().catch(() => undefined);
      await control.end();
    }
  }
}


export class FtpSource implements MibSource {
  readonly id: string;
  readonly kind = 'ftp' as const;
  readonly name: string;
  readonly enabled: boolean;
  readonly priority: number;
  readonly hosts: string[];

  constructor(
    private readonly config: FtpSourceConfig,
    private readonly client: FtpClient,
    private readonly resolveSecret?: SecretResolver,
  ) {
    this.id = config.id;
    this.name = config.name;
    this.enabled = config.enabled;
    this.priority = config.priority;
    this.hosts = [config.host];
  }

  async fetch(module: string, context?: { signal?: AbortSignal }): Promise<SourceFetchResult> {
    if (context?.signal?.aborted) throw new Error('operation aborted');
    const password = this.config.passwordRef
      ? await this.resolvePassword(this.config.passwordRef)
      : undefined;
    for (const path of buildFtpPathCandidates(this.config.pathTemplate, module, this.config.fixedExtension)) {
      if (context?.signal?.aborted) throw new Error('operation aborted');
      try {
        const bytes = await this.client.retrieve({
          host: this.config.host,
          port: this.config.port,
          secure: this.config.secure,
          username: this.config.anonymous ? undefined : this.config.username,
          password: this.config.anonymous ? undefined : password,
          path,
          signal: context?.signal,
        });
        const content = new TextDecoder().decode(bytes);
        const validation = validateMibContent(module, content);
        if (!validation.ok) continue;
        const protocol = this.config.secure === 'ftps-explicit' ? 'ftps' : 'ftp';
        const port = this.config.port ? `:${this.config.port}` : '';
        return {
          status: 'found',
          module,
          content,
          sourceId: this.id,
          location: `${protocol}://${this.config.host}${port}${path.startsWith('/') ? path : `/${path}`}`,
          moduleName: validation.moduleName,
          warnings: validation.warnings,
        };
      } catch (error) {
        if (isFileUnavailable(error)) continue;
        throw error;
      }
    }
    return { status: 'not-found', module, sourceId: this.id };
  }

  private async resolvePassword(reference: string): Promise<string> {
    if (!this.resolveSecret) throw new Error('FTP passwordRef requires a secret resolver');
    const value = await this.resolveSecret(reference);
    if (value === null) throw new Error(`Secret not found: ${reference}`);
    return value;
  }
}
