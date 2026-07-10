import { describe, it, expect, afterEach } from 'vitest';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeUdpFactory } from './udp';
import { nodeStorageFactory } from './storage';
import { nodeHttpClient } from './http';
import { createNodeFileStore } from './files';

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
    const fs = createNodeFileStore(join(tmpdir(), 'omc-test'));
    const p = fs.join(fs.dataDir(), 'sample.txt');
    await fs.writeText(p, 'hello');
    expect(await fs.readText(p)).toBe('hello');
    expect(await fs.exists(p)).toBe(true);
    await fs.remove(p);
    expect(await fs.exists(p)).toBe(false);
  });
});

describe('nodeHttpClient', () => {
  const servers: Array<{ close: () => void }> = [];
  afterEach(() => {
    servers.forEach((s) => s.close());
    servers.length = 0;
  });

  it('fetches text with the OMC user-agent', async () => {
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
    expect(seenUa).toMatch(/OpenMIBCatalog/);
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
