import { describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createNodeTransport, nodeStorageFactory } from '@mibbeacon/transport/node';
import { createEngine } from './engine';
import { EventBus } from './events';
import { LogService } from './logs';

type LogEntry = { level: 'error'; message: string };
type LogsAPI = { query(filter: { level: 'error' }): Promise<LogEntry[]> };

describe('engine logs domain', () => {
  it('captures startup failures in memory and redacts credential-like values', async () => {
    const base = createNodeTransport({ dataDir: tmpdir() });
    let attempts = 0;
    const engine = createEngine({
      ...base,
      storage: {
        open(path) {
          attempts += 1;
          if (attempts === 1) {
            throw new Error(
              'connect failed community=private authKey="auth-secret" password=hunter2 ' +
                '{"privKey":"privacy-secret","token":"token-secret"}',
            );
          }
          return nodeStorageFactory.open(path);
        },
      },
    });
    const logs = engine.logs as unknown as LogsAPI;

    const entries: LogEntry[] = await logs.query({ level: 'error' });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ level: 'error' });
    expect(entries[0]?.message).toContain('DB init failed');
    expect(entries[0]?.message).toContain('community=***');
    expect(entries[0]?.message).toContain('authKey=***');
    expect(entries[0]?.message).toContain('password=***');
    expect(entries[0]?.message).toContain('"privKey":***');
    expect(entries[0]?.message).toContain('"token":***');
    expect(entries[0]?.message).not.toContain('private');
    expect(entries[0]?.message).not.toContain('auth-secret');
    expect(entries[0]?.message).not.toContain('hunter2');
    expect(entries[0]?.message).not.toContain('privacy-secret');
    expect(entries[0]?.message).not.toContain('token-secret');
  });

  it('applies runtime log levels before storing or emitting entries', async () => {
    const bus = new EventBus();
    const emitted: unknown[] = [];
    bus.subscribe('logs', (event) => {
      if (event.kind === 'entry') emitted.push(event.payload);
    });
    const service = new LogService(bus);
    const logs = service.api as typeof service.api & {
      setLevel(level: 'warn'): Promise<void>;
    };

    await logs.setLevel('warn');
    service.write('info', 'ignored');
    service.write('error', 'kept');

    await expect(logs.query()).resolves.toMatchObject([{ level: 'error', message: 'kept' }]);
    expect(emitted).toHaveLength(1);
  });

  it('rejects unknown runtime log levels received across an untyped bridge', async () => {
    const logs = new LogService(new EventBus()).api;

    await expect(logs.setLevel('verbose' as never)).rejects.toThrow(/log level/i);
  });

  it('rejects malformed query filters received across an untyped bridge', async () => {
    const logs = new LogService(new EventBus()).api;

    await expect(logs.query({ level: 'verbose' } as never)).rejects.toThrow(/log level/i);
    await expect(logs.query({ minLevel: 'verbose' } as never)).rejects.toThrow(/log level/i);
    await expect(logs.query({ since: Number.NaN } as never)).rejects.toThrow(/since/i);
    await expect(logs.query({ until: Number.POSITIVE_INFINITY } as never)).rejects.toThrow(
      /until/i,
    );
    await expect(logs.query({ limit: -1 } as never)).rejects.toThrow(/limit/i);
  });

  it('bounds the ring and supports time, severity, search, and latest-entry filters', async () => {
    let now = 0;
    const service = new LogService(new EventBus(), () => ++now, 2);
    service.write('info', 'first');
    service.write('warn', 'second');
    service.write('error', 'third failure');
    const logs = service.api as typeof service.api & {
      query(filter: {
        minLevel: 'warn';
        since: number;
        search: string;
        limit: number;
      }): Promise<Array<{ id: string; timestamp: number; message: string }>>;
    };

    await expect(logs.query()).resolves.toMatchObject([
      { id: 'log-2', timestamp: 2, message: 'second' },
      { id: 'log-3', timestamp: 3, message: 'third failure' },
    ]);
    await expect(
      logs.query({ minLevel: 'warn', since: 3, search: 'FAILURE', limit: 1 }),
    ).resolves.toMatchObject([{ id: 'log-3', timestamp: 3, message: 'third failure' }]);
  });

  it('exports the redacted in-memory ring as JSON lines without persisting it to SQLite', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mibbeacon-logs-'));
    const output = join(directory, 'support', 'engine.jsonl');
    const base = createNodeTransport({ dataDir: directory });
    let attempts = 0;
    const engine = createEngine({
      ...base,
      storage: {
        open(path) {
          attempts += 1;
          if (attempts === 1) throw new Error('community=topsecret');
          return nodeStorageFactory.open(path);
        },
      },
    });
    const logs = engine.logs as unknown as LogsAPI & {
      export(path: string): Promise<{ path: string; count: number }>;
    };

    await expect(logs.export(output)).resolves.toEqual({ path: output, count: 1 });
    const lines = (await readFile(output, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ level: 'error' });
    expect(lines[0]).toContain('community=***');
    expect(lines[0]).not.toContain('topsecret');
  });
});
