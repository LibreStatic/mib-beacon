import { describe, expect, it } from 'vitest';
import type { TcpSocket, TcpSocketFactory } from '@omc/transport';
import {
  FtpSource,
  PassiveFtpClient,
  buildFtpPathCandidates,
  renderFtpPath,
  type FtpRetrieveRequest,
} from './ftp';

class ScriptedSocket implements TcpSocket {
  private dataListeners = new Set<(data: Uint8Array) => void>();
  private errorListeners = new Set<(error: Error) => void>();
  private closeListeners = new Set<() => void>();
  private connected = false;

  constructor(
    private readonly kind: 'control' | 'data',
    private readonly transcript: string[],
    private readonly retrieveAvailable = true,
    private readonly passiveAddress = '127,0,0,1,156,64',
  ) {}

  async connect(port: number, host: string, opts?: { tls?: boolean }): Promise<void> {
    this.transcript.push(`CONNECT ${this.kind} ${host}:${port} tls=${String(Boolean(opts?.tls))}`);
    this.connected = true;
    if (this.kind === 'control') setTimeout(() => this.emit('220 fixture ready\r\n'), 0);
  }

  async startTls(options?: { serverName?: string; rejectUnauthorized?: boolean }): Promise<void> {
    this.transcript.push(`STARTTLS ${this.kind} serverName=${options?.serverName ?? ''}`);
  }

  async write(data: Uint8Array): Promise<void> {
    const command = new TextDecoder().decode(data).trim();
    this.transcript.push(command);
    if (this.kind !== 'control') return;
    if (command === 'AUTH TLS') this.emit('234 TLS negotiation accepted\r\n');
    else if (command === 'PBSZ 0') this.emit('200 protection buffer size accepted\r\n');
    else if (command === 'PROT P') this.emit('200 private data protection accepted\r\n');
    else if (command.startsWith('USER ')) this.emit('331 password required\r\n');
    else if (command.startsWith('PASS ')) this.emit('230 logged in\r\n');
    else if (command === 'TYPE I') this.emit('200 binary mode\r\n');
    else if (command === 'PASV') this.emit(`227 Entering Passive Mode (${this.passiveAddress})\r\n`);
    else if (command.startsWith('RETR ')) {
      if (!this.retrieveAvailable) {
        this.emit('550 file unavailable\r\n');
        return;
      }
      this.emit('150 opening data connection\r\n');
      queueMicrotask(() => {
        this.dataSocket?.emitBytes(new TextEncoder().encode('TEST-MIB DEFINITIONS ::= BEGIN\nEND'));
        this.dataSocket?.emitClose();
        this.emit('226 transfer complete\r\n');
      });
    } else if (command === 'QUIT') this.emit('221 bye\r\n');
  }

  dataSocket?: ScriptedSocket;

  onData(listener: (data: Uint8Array) => void): () => void {
    if (!this.connected) return () => undefined;
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }
  onError(listener: (err: Error) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }
  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }
  async end(): Promise<void> {}

  private emit(text: string): void {
    this.emitBytes(new TextEncoder().encode(text));
  }
  private emitBytes(bytes: Uint8Array): void {
    for (const listener of this.dataListeners) listener(bytes);
  }
  private emitClose(): void {
    for (const listener of this.closeListeners) listener();
  }
}

class ScriptedFactory implements TcpSocketFactory {
  readonly transcript: string[] = [];
  private control?: ScriptedSocket;

  constructor(
    private readonly retrieveAvailable = true,
    private readonly passiveAddress = '127,0,0,1,156,64',
  ) {}

  create(): TcpSocket {
    if (!this.control) {
      this.control = new ScriptedSocket('control', this.transcript, this.retrieveAvailable, this.passiveAddress);
      return this.control;
    }
    const data = new ScriptedSocket('data', this.transcript);
    this.control.dataSocket = data;
    return data;
  }
}

const request: FtpRetrieveRequest = {
  host: 'ftp.example.test',
  port: 21,
  secure: 'none',
  username: 'operator',
  password: 'secret',
  path: '/pub/TEST-MIB.mib',
  timeoutMs: 1_000,
  maxBytes: 1_024,
};

describe('FTP source helpers', () => {
  it('renders @mib@ and appends the name when the token is absent', () => {
    expect(renderFtpPath('/pub/@mib@.txt', 'IF-MIB')).toBe('/pub/IF-MIB.txt');
    expect(renderFtpPath('/pub/mibs/', 'IF-MIB')).toBe('/pub/mibs/IF-MIB');
  });

  it('builds bounded case and extension variants, or one fixed-extension path', () => {
    const candidates = buildFtpPathCandidates('/mibs/@mib@', 'If-Mib');
    expect(candidates).toEqual([
      '/mibs/If-Mib', '/mibs/If-Mib.txt', '/mibs/If-Mib.mib', '/mibs/If-Mib.my',
      '/mibs/If-Mib.TXT', '/mibs/If-Mib.MIB', '/mibs/If-Mib.MY',
      '/mibs/IF-MIB', '/mibs/IF-MIB.txt', '/mibs/IF-MIB.mib', '/mibs/IF-MIB.my',
      '/mibs/IF-MIB.TXT', '/mibs/IF-MIB.MIB', '/mibs/IF-MIB.MY',
      '/mibs/if-mib', '/mibs/if-mib.txt', '/mibs/if-mib.mib', '/mibs/if-mib.my',
      '/mibs/if-mib.TXT', '/mibs/if-mib.MIB', '/mibs/if-mib.MY',
    ]);
    expect(buildFtpPathCandidates('/mibs/@mib@', 'IF-MIB', '.my')).toEqual(['/mibs/IF-MIB.my']);
  });
});

describe('PassiveFtpClient', () => {
  it('logs in and retrieves a file over a passive data socket', async () => {
    const factory = new ScriptedFactory();
    const result = await new PassiveFtpClient(factory).retrieve(request);

    expect(new TextDecoder().decode(result)).toContain('TEST-MIB DEFINITIONS');
    expect(factory.transcript).toEqual([
      'CONNECT control ftp.example.test:21 tls=false',
      'USER operator',
      'PASS secret',
      'TYPE I',
      'PASV',
      'CONNECT data ftp.example.test:40000 tls=false',
      'RETR /pub/TEST-MIB.mib',
      'QUIT',
    ]);
  });
});

describe('FTP safety and compatibility', () => {
  it('ignores a forged PASV host and opens the data port on the control host', async () => {
    const factory = new ScriptedFactory(true, '10,0,0,7,156,64');

    await new PassiveFtpClient(factory).retrieve(request);

    expect(factory.transcript).toContain('CONNECT data ftp.example.test:40000 tls=false');
    expect(factory.transcript).not.toContain('CONNECT data 10.0.0.7:40000 tls=false');
  });

  it('rejects control-channel newline injection before opening a socket', async () => {
    const factory = new ScriptedFactory();
    await expect(new PassiveFtpClient(factory).retrieve({ ...request, path: '/pub/ok\r\nDELE /important' }))
      .rejects.toThrow('invalid FTP path');
    expect(factory.transcript).toEqual([]);
  });

  it('rejects newline injection in FTP credentials before opening a socket', async () => {
    const factory = new ScriptedFactory();
    await expect(new PassiveFtpClient(factory).retrieve({ ...request, username: 'operator\r\nDELE /important' }))
      .rejects.toThrow('invalid FTP credentials');
    expect(factory.transcript).toEqual([]);
  });

  it('upgrades both control and protected passive data connections for explicit FTPS', async () => {
    const factory = new ScriptedFactory();
    const result = await new PassiveFtpClient(factory).retrieve({ ...request, secure: 'ftps-explicit' });

    expect(new TextDecoder().decode(result)).toContain('TEST-MIB DEFINITIONS');
    expect(factory.transcript).toEqual([
      'CONNECT control ftp.example.test:21 tls=false',
      'AUTH TLS',
      'STARTTLS control serverName=ftp.example.test',
      'PBSZ 0',
      'PROT P',
      'USER operator',
      'PASS secret',
      'TYPE I',
      'PASV',
      'CONNECT data ftp.example.test:40000 tls=false',
      'STARTTLS data serverName=ftp.example.test',
      'RETR /pub/TEST-MIB.mib',
      'QUIT',
    ]);
  });

  it('marks a 550 RETR response as a file-unavailable protocol error', async () => {
    const client = new PassiveFtpClient(new ScriptedFactory(false));

    await expect(client.retrieve(request)).rejects.toMatchObject({
      name: 'FtpProtocolError',
      code: 550,
      stage: 'retrieve',
    });
  });
});

describe('FtpSource', () => {
  it('probes paths, validates content, and attributes the accepted file', async () => {
    const requests: FtpRetrieveRequest[] = [];
    const client = {
      async retrieve(value: FtpRetrieveRequest) {
        requests.push(value);
        return new TextEncoder().encode(requests.length === 1 ? '<html>missing</html>' : 'IF-MIB DEFINITIONS ::= BEGIN\nEND');
      },
    };
    const source = new FtpSource({
      id: 'ftp', kind: 'ftp', name: 'Internal FTP', enabled: true, priority: 1,
      host: 'ftp.example.test', secure: 'none', anonymous: true, pathTemplate: '/mibs/@mib@',
    }, client);
    const result = await source.fetch('IF-MIB');
    expect(requests.map(({ path }) => path)).toEqual(['/mibs/IF-MIB', '/mibs/IF-MIB.txt']);
    expect(result).toMatchObject({ status: 'found', module: 'IF-MIB', sourceId: 'ftp', location: 'ftp://ftp.example.test/mibs/IF-MIB.txt' });
  });

  it.each([
    ['TLS', new Error('TLS certificate rejected')],
    ['authentication', new Error('FTP login failed (530): invalid credentials')],
  ])('propagates %s failures instead of reporting the module as not found', async (_kind, failure) => {
    const source = new FtpSource({
      id: 'ftp', kind: 'ftp', name: 'Private FTPS', enabled: true, priority: 1,
      host: 'ftp.example.test', secure: 'ftps-explicit', anonymous: false,
      username: 'operator', pathTemplate: '/mibs/@mib@', fixedExtension: '.mib',
    }, { retrieve: async () => { throw failure; } });

    await expect(source.fetch('IF-MIB')).rejects.toBe(failure);
  });

  it('continues variant probing only when RETR reports that a file is unavailable', async () => {
    let unavailable: unknown;
    try {
      await new PassiveFtpClient(new ScriptedFactory(false)).retrieve(request);
    } catch (error) {
      unavailable = error;
    }
    let attempts = 0;
    const source = new FtpSource({
      id: 'ftp', kind: 'ftp', name: 'Public FTP', enabled: true, priority: 1,
      host: 'ftp.example.test', secure: 'none', anonymous: true, pathTemplate: '/mibs/@mib@',
    }, {
      async retrieve() {
        attempts += 1;
        if (attempts === 1) throw unavailable;
        return new TextEncoder().encode('IF-MIB DEFINITIONS ::= BEGIN\nEND');
      },
    });

    await expect(source.fetch('IF-MIB')).resolves.toMatchObject({ status: 'found' });
    expect(attempts).toBe(2);
  });
});

describe('FTP cancellation', () => {
  it('propagates the source abort signal to the FTP client', async () => {
    let received: AbortSignal | undefined;
    const client: FtpClient = {
      async retrieve(value) {
        received = value.signal;
        throw new Error('operation aborted');
      },
    };
    const source = new FtpSource({
      id: 'ftp-abort', kind: 'ftp', name: 'FTP', enabled: true, priority: 1,
      host: 'ftp.test', secure: 'none', anonymous: true, pathTemplate: '/@mib@',
    }, client);
    const controller = new AbortController();
    await expect(source.fetch('IF-MIB', { signal: controller.signal })).rejects.toThrow('aborted');
    expect(received).toBe(controller.signal);
  });

  it('aborts a hanging connect promptly and closes the control socket', async () => {
    let ended = false;
    const hanging: TcpSocket = {
      connect: async () => new Promise<void>(() => undefined),
      startTls: async () => undefined,
      write: async () => undefined,
      onData: () => () => undefined,
      onError: () => () => undefined,
      onClose: () => () => undefined,
      end: async () => { ended = true; },
    };
    const controller = new AbortController();
    const pending = new PassiveFtpClient({ create: () => hanging }).retrieve({
      ...request, signal: controller.signal, timeoutMs: 10_000,
    });
    controller.abort();
    await expect(pending).rejects.toThrow('aborted');
    expect(ended).toBe(true);
  });
});
