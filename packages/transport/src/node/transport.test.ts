import { describe, it, expect, afterEach } from 'vitest';
import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { createServer as createTlsServer } from 'node:tls';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeUdpFactory } from './udp';
import { nodeStorageFactory } from './storage';
import { nodeHttpClient } from './http';
import { createNodeFileStore } from './files';
import { nodeTcpFactory } from './tcp';
import { createPersistentSecretStore, type SecretCodec } from './secrets';

const FTPS_KEY = readFileSync(new URL('./fixtures/ftps-key.pem', import.meta.url));
const FTPS_CERT = readFileSync(new URL('./fixtures/ftps-cert.pem', import.meta.url));

describe('nodeTcpFactory', () => {
  it('upgrades an established TCP socket to TLS without losing data listeners', async () => {
    const tlsServer = createTlsServer({ key: FTPS_KEY, cert: FTPS_CERT }, (socket) => {
      socket.on('data', (data) => {
        if (data.toString() === 'PING\r\n') socket.write('PONG\r\n');
      });
    });
    const server = createTcpServer((socket) => {
      socket.write('220 ready\r\n');
      socket.once('data', (data) => {
        expect(data.toString()).toBe('AUTH TLS\r\n');
        socket.write('234 proceed\r\n', () => tlsServer.emit('connection', socket));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('TCP fixture did not bind');

    const client = nodeTcpFactory.create();
    await client.connect(address.port, '127.0.0.1');
    let received = '';
    const waiters = new Set<() => void>();
    client.onData((data) => {
      received += new TextDecoder().decode(data);
      for (const resolve of waiters) resolve();
    });
    const waitFor = async (text: string): Promise<void> => {
      while (!received.includes(text)) {
        await new Promise<void>((resolve) => {
          waiters.add(resolve);
          setTimeout(resolve, 1_000);
        });
      }
    };

    await waitFor('220 ready');
    await client.write(new TextEncoder().encode('AUTH TLS\r\n'));
    await waitFor('234 proceed');
    await client.startTls({ serverName: 'localhost', rejectUnauthorized: false });
    await client.write(new TextEncoder().encode('PING\r\n'));
    await waitFor('PONG');

    await client.end();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    tlsServer.close();
  });
});

describe('nodeUdpFactory', () => {
  it('round-trips a datagram between two sockets', async () => {
    const server = nodeUdpFactory.create('udp4');
    const client = nodeUdpFactory.create('udp4');
    await server.bind(0, '127.0.0.1');
    const addr = server.address();
    expect(addr).not.toBeNull();

    const received = new Promise<string>((resolve) => {
      server.onMessage((msg) => resolve(new TextDecoder().decode(msg.data)));
    });

    await client.send(new TextEncoder().encode('ping'), addr!.port, '127.0.0.1');
    expect(await received).toBe('ping');

    await server.close();
    await client.close();
  });
});

describe('nodeStorageFactory', () => {
  it('creates tables and round-trips rows', () => {
    const db = nodeStorageFactory.open(':memory:');
    db.exec('CREATE TABLE t (k TEXT PRIMARY KEY, v INTEGER)');
    const res = db.run('INSERT INTO t (k, v) VALUES (?, ?)', ['a', 42]);
    expect(res.changes).toBe(1);
    const row = db.get<{ k: string; v: number }>('SELECT * FROM t WHERE k = ?', ['a']);
    expect(row).toEqual({ k: 'a', v: 42 });
    expect(db.all('SELECT * FROM t')).toHaveLength(1);
    db.close();
  });

  it('rolls back a failed transaction', () => {
    const db = nodeStorageFactory.open(':memory:');
    db.exec('CREATE TABLE t (k TEXT PRIMARY KEY)');
    expect(() =>
      db.transaction(() => {
        db.run('INSERT INTO t (k) VALUES (?)', ['x']);
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(db.all('SELECT * FROM t')).toHaveLength(0);
    db.close();
  });
});

describe('nodeFileStore', () => {
  it('writes and reads bytes and text', async () => {
    const fs = createNodeFileStore(join(tmpdir(), 'mibbeacon-test'));
    const p = fs.join(fs.dataDir(), 'sample.txt');
    await fs.writeText(p, 'hello');
    expect(await fs.readText(p)).toBe('hello');
    expect(await fs.exists(p)).toBe(true);
    await fs.remove(p);
    expect(await fs.exists(p)).toBe(false);
  });
});

describe('persistent encrypted secret store', () => {
  it('survives store recreation without writing plaintext and keeps its file private', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mibbeacon-secrets-'));
    const filePath = join(directory, 'resolver-secrets.json');
    const codec: SecretCodec = {
      encrypt: (plaintext) => Buffer.from(`sealed:${plaintext}`).toString('base64'),
      decrypt: (ciphertext) => Buffer.from(ciphertext, 'base64').toString().replace(/^sealed:/, ''),
      isEncrypted: () => true,
    };

    const first = createPersistentSecretStore({ filePath, codec });
    await first.set('resolver-source:private:password', 'correct horse battery staple');

    const second = createPersistentSecretStore({ filePath, codec });
    await expect(second.get('resolver-source:private:password')).resolves.toBe(
      'correct horse battery staple',
    );
    expect(await readFile(filePath, 'utf8')).not.toContain('correct horse battery staple');
    expect((await stat(filePath)).mode & 0o077).toBe(0);
  });
});

describe('nodeHttpClient', () => {
  const servers: Array<{ close: () => void }> = [];
  afterEach(() => {
    servers.forEach((s) => s.close());
    servers.length = 0;
  });

  it('fetches text with the MIB Beacon user-agent', async () => {
    let seenUa = '';
    const srv = createServer((req, res) => {
      seenUa = req.headers['user-agent'] ?? '';
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('IF-MIB DEFINITIONS ::= BEGIN');
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    servers.push(srv);
    const port = (srv.address() as { port: number }).port;

    const res = await nodeHttpClient.fetch({ url: `http://127.0.0.1:${port}/IF-MIB` });
    expect(res.ok).toBe(true);
    expect(res.text).toContain('DEFINITIONS ::= BEGIN');
    expect(seenUa).toMatch(/MIBBeacon/);
  });

  it('aborts on timeout', async () => {
    const srv = createServer(() => {
      /* never responds */
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    servers.push(srv);
    const port = (srv.address() as { port: number }).port;

    await expect(
      nodeHttpClient.fetch({ url: `http://127.0.0.1:${port}/`, timeoutMs: 150 }),
    ).rejects.toThrow();
  });

  it('aborts promptly when the caller signal is cancelled', async () => {
    const srv = createServer(() => { /* never responds */ });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    servers.push(srv);
    const port = (srv.address() as { port: number }).port;
    const controller = new AbortController();
    const pending = nodeHttpClient.fetch({ url: `http://127.0.0.1:${port}/`, timeoutMs: 10_000, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow();
  });

  it('rejects responses over the byte cap', async () => {
    const srv = createServer((_req, res) => {
      res.writeHead(200);
      res.end('x'.repeat(10_000));
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    servers.push(srv);
    const port = (srv.address() as { port: number }).port;

    await expect(
      nodeHttpClient.fetch({ url: `http://127.0.0.1:${port}/`, maxBytes: 1000 }),
    ).rejects.toThrow(/exceeds/);
  });
});
