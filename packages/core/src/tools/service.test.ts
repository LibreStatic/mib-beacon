import { describe, expect, it, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createNodeTransport } from '@mibbeacon/transport/node';
import type { SecretStore, Transport } from '@mibbeacon/transport';
import { createEngine } from '../engine';
import type { DecodedVarbind } from '../snmp/types';
import { buildPortRows } from './service';

function encryptedSecrets(): SecretStore {
  const values = new Map<string, string>();
  return {
    set: async (key, value) => {
      values.set(key, value);
    },
    get: async (key) => values.get(key) ?? null,
    delete: async (key) => {
      values.delete(key);
    },
    isEncrypted: () => true,
  };
}

function varbind(oid: string, value: string | number, typeName = 'Counter64'): DecodedVarbind {
  return { oid, value, rawValue: value, type: 70, typeName, isError: false };
}

async function savedAgent(engine: ReturnType<typeof createEngine>, host = '127.0.0.1') {
  return engine.agents.create({
    profile: { name: host, host, version: 'v2c' },
    secrets: { community: 'fixture' },
  });
}

describe('tools service', () => {
  it('batches due series, persists wrap-safe rates, prunes retention, and emits a threshold alert', async () => {
    let now = 0;
    let counter = '18446744073709551610';
    const tester = vi.fn(async (_agent, oids: string[]) =>
      oids.map((oid) => varbind(oid, counter)),
    );
    const transport = createNodeTransport({ secrets: encryptedSecrets() });
    const engine = createEngine(transport, {
      dbPath: ':memory:',
      agentTester: tester,
      tools: { now: () => now },
    });
    const agent = await savedAgent(engine);
    const first = await engine.tools.polls.create({
      name: 'Inbound rate',
      agentId: agent.id,
      oid: '1.3.6.1.2.1.2.2.1.10.1',
      intervalMs: 60_000,
      mode: 'rate-per-sec',
      counterBits: 64,
      retention: 10,
    });
    await engine.tools.polls.create({
      name: 'Errors',
      agentId: agent.id,
      oid: '1.3.6.1.2.1.2.2.1.14.1',
      intervalMs: 60_000,
      mode: 'raw',
      retention: 10,
    });
    await engine.tools.watches.save({
      seriesId: first.id,
      name: 'High inbound',
      operator: '>',
      threshold: 10,
      thresholdMode: 'value',
    });
    const alerts: unknown[] = [];
    engine.events.subscribe('tools', (event) => {
      if (event.kind === 'watch-alert') alerts.push(event.payload);
    });

    await engine.tools.polls.sampleNow();
    expect(tester).toHaveBeenCalledTimes(1);
    expect(tester.mock.calls[0]?.[1]).toHaveLength(2);
    now = 1_000;
    counter = '25';
    // Force due while preserving the production scheduler's persisted due field.
    await engine.tools.polls.update(first.id, { intervalMs: 60_000 });
    const errors = (await engine.tools.polls.list()).find((series) => series.name === 'Errors')!;
    await engine.tools.polls.update(errors.id, { intervalMs: 60_000 });
    await engine.tools.polls.sampleNow();

    const samples = await engine.tools.polls.samples(first.id);
    expect(samples.at(-1)?.value).toBe(31);
    expect(alerts).toHaveLength(1);
    expect(await engine.tools.polls.exportCsv(first.id)).toContain(
      'timestamp,raw_value,value,type',
    );
  });

  it('persists poll history across an engine restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mibbeacon-tools-'));
    const dbPath = join(dir, 'tools.db');
    const transport = createNodeTransport({ dataDir: dir, secrets: encryptedSecrets() });
    const first = createEngine(transport, {
      dbPath,
      agentTester: async (_agent, oids) => oids.map((oid) => varbind(oid, 42, 'Gauge')),
    });
    const agent = await savedAgent(first);
    const series = await first.tools.polls.create({
      name: 'Gauge',
      agentId: agent.id,
      oid: '1.3.6.1.2.1.1.3.0',
      intervalMs: 60_000,
      mode: 'raw',
    });
    await first.tools.polls.sampleNow([series.id]);

    const second = createEngine(createNodeTransport({ dataDir: dir, secrets: transport.secrets }), {
      dbPath,
    });
    await expect(second.tools.polls.samples(series.id)).resolves.toMatchObject([
      expect.objectContaining({ rawValue: '42', value: 42 }),
    ]);
  });

  it('persists exponential poll backoff and marks the third consecutive failure degraded', async () => {
    let now = 0;
    const tester = vi.fn(async () => {
      throw new Error('fixture timeout');
    });
    const engine = createEngine(createNodeTransport({ secrets: encryptedSecrets() }), {
      dbPath: ':memory:',
      agentTester: tester,
      tools: { now: () => now },
    });
    const agent = await savedAgent(engine);
    const series = await engine.tools.polls.create({
      name: 'Backoff fixture',
      agentId: agent.id,
      oid: '1.3.6.1.2.1.1.3.0',
      intervalMs: 1_000,
      mode: 'raw',
    });
    const degraded: boolean[] = [];
    engine.events.subscribe('tools', (event) => {
      if (event.kind === 'poll-error')
        degraded.push(Boolean((event.payload as { degraded: boolean }).degraded));
    });

    await engine.tools.polls.sampleNow([series.id]);
    expect((await engine.tools.polls.list())[0]).toMatchObject({ errorCount: 1, nextDueAt: 1_000 });
    now = 1_000;
    await engine.tools.polls.sampleNow([series.id]);
    expect((await engine.tools.polls.list())[0]).toMatchObject({ errorCount: 2, nextDueAt: 3_000 });
    now = 2_000;
    await engine.tools.polls.sampleNow([series.id]);
    expect(tester).toHaveBeenCalledTimes(2);
    now = 3_000;
    await engine.tools.polls.sampleNow([series.id]);
    expect((await engine.tools.polls.list())[0]).toMatchObject({ errorCount: 3, nextDueAt: 7_000 });
    expect(degraded).toEqual([false, false, true]);
  });

  it('reloads persisted due state on scheduler ticks so backoff skips intermediate intervals', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const tester = vi.fn(async () => {
        throw new Error('fixture timeout');
      });
      const engine = createEngine(createNodeTransport({ secrets: encryptedSecrets() }), {
        dbPath: ':memory:',
        agentTester: tester,
      });
      const agent = await savedAgent(engine);
      const series = await engine.tools.polls.create({
        name: 'Scheduled backoff',
        agentId: agent.id,
        oid: '1.3.6.1.2.1.1.3.0',
        intervalMs: 1_000,
        mode: 'raw',
      });

      await vi.advanceTimersByTimeAsync(1_000);
      expect(tester).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(tester).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(tester).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(tester).toHaveBeenCalledTimes(3);
      await engine.tools.polls.update(series.id, { paused: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('streams bounded discovery with credential attribution and concurrency', async () => {
    let active = 0;
    let maximum = 0;
    const tester = vi.fn(async (agent, oids: string[]) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      if (!['192.0.2.1', '192.0.2.3', '192.0.2.5'].includes(agent.host)) throw new Error('timeout');
      return oids.map((oid) =>
        varbind(oid, oid.endsWith('5.0') ? `device-${agent.host}` : 'fixture', 'OctetString'),
      );
    });
    const engine = createEngine(createNodeTransport({ secrets: encryptedSecrets() }), {
      dbPath: ':memory:',
      agentTester: tester,
    });
    const agent = await savedAgent(engine);
    const results: Array<{ ip: string; credentialLabel: string }> = [];
    let done!: () => void;
    const terminal = new Promise<void>((resolve) => {
      done = resolve;
    });
    engine.events.subscribe('tools', (event) => {
      if (event.kind === 'discovery-result')
        results.push(event.payload as (typeof results)[number]);
      if (event.kind === 'done') done();
    });
    await engine.tools.discovery.start({
      target: '192.0.2.0/29',
      credentials: [{ agentId: agent.id, label: 'fixture profile' }],
      concurrency: 2,
    });
    await terminal;

    expect(results.map((result) => result.ip)).toEqual(['192.0.2.1', '192.0.2.3', '192.0.2.5']);
    expect(results.every((result) => result.credentialLabel === 'fixture profile')).toBe(true);
    expect(maximum).toBeLessThanOrEqual(2);
  });

  it('optionally pre-pings desktop discovery hosts and skips ICMP-negative addresses', async () => {
    const base = createNodeTransport({ secrets: encryptedSecrets() });
    const run = vi.fn(async (_command: string, args: string[]) => ({
      exitCode: args.at(-1) === '192.0.2.1' ? 0 : 1,
    }));
    const tester = vi.fn(async (_agent, oids: string[]) =>
      oids.map((oid) => varbind(oid, 'fixture', 'OctetString')),
    );
    const engine = createEngine(
      { ...base, commands: { run } },
      {
        dbPath: ':memory:',
        agentTester: tester,
      },
    );
    const agent = await savedAgent(engine);
    const found: string[] = [];
    let done!: () => void;
    const terminal = new Promise<void>((resolve) => {
      done = resolve;
    });
    engine.events.subscribe('tools', (event) => {
      if (event.kind === 'discovery-result') found.push((event.payload as { ip: string }).ip);
      if (event.kind === 'done') done();
    });

    await engine.tools.discovery.start({
      target: '192.0.2.1-192.0.2.2',
      credentials: [{ agentId: agent.id, label: 'fixture' }],
      concurrency: 1,
      prePing: true,
    });
    await terminal;
    expect(run).toHaveBeenCalledTimes(2);
    expect(tester).toHaveBeenCalledTimes(1);
    expect(found).toEqual(['192.0.2.1']);
  });

  it('cancels a streaming discovery handle without scheduling the remaining range', async () => {
    let releaseProbe!: () => void;
    const blockedProbe = new Promise<void>((resolve) => {
      releaseProbe = resolve;
    });
    const tester = vi.fn(async (_agent, oids: string[]) => {
      await blockedProbe;
      return oids.map((oid) => varbind(oid, 'fixture', 'OctetString'));
    });
    const engine = createEngine(createNodeTransport({ secrets: encryptedSecrets() }), {
      dbPath: ':memory:',
      agentTester: tester,
    });
    const agent = await savedAgent(engine);
    let cancelled!: () => void;
    const terminal = new Promise<void>((resolve) => {
      cancelled = resolve;
    });
    let handleId = '';
    let cancellationEvents = 0;
    engine.events.subscribe('tools', (event) => {
      if (event.handleId === handleId && event.kind === 'cancelled') {
        cancellationEvents += 1;
        cancelled();
      }
    });
    const operation = await engine.tools.discovery.start({
      target: '192.0.2.0/24',
      credentials: [{ agentId: agent.id, label: 'fixture' }],
      concurrency: 2,
    });
    handleId = operation.handleId;
    await engine.tools.discovery.cancel(handleId);
    await Promise.race([
      terminal,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('cancellation was not immediate')), 50),
      ),
    ]);
    expect(cancellationEvents).toBe(1);
    releaseProbe();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cancellationEvents).toBe(1);
    expect(tester.mock.calls.length).toBeLessThan(254);
  });

  it('streams fixed-command reachability output and rejects it when unavailable', async () => {
    const base = createNodeTransport();
    const run = vi.fn(async (_command, _args, options) => {
      options?.onLine?.('64 bytes from fixture', 'stdout');
      options?.onLine?.('2 packets transmitted, 2 received, 0% packet loss', 'stdout');
      options?.onLine?.('rtt min/avg/max/mdev = 1.000/2.000/3.000/0.500 ms', 'stdout');
      return { exitCode: 0 };
    });
    const transport: Transport = { ...base, commands: { run } };
    const engine = createEngine(transport, { dbPath: ':memory:' });
    const lines: string[] = [];
    const summaries: unknown[] = [];
    engine.events.subscribe('tools', (event) => {
      if (event.kind === 'reachability-line') lines.push((event.payload as { line: string }).line);
      if (event.kind === 'done') summaries.push((event.payload as { summary?: unknown }).summary);
    });
    await engine.tools.reachability.start({
      kind: 'ping',
      target: '127.0.0.1',
      count: 2,
      intervalMs: 500,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(run).toHaveBeenCalledWith(
      'ping',
      ['-n', '-c', '2', '-i', '0.5', '127.0.0.1'],
      expect.any(Object),
    );
    expect(lines).toHaveLength(3);
    expect(summaries).toContainEqual({
      transmitted: 2,
      received: 2,
      lossPercent: 0,
      minMs: 1,
      avgMs: 2,
      maxMs: 3,
    });

    const mobile = createEngine(
      { ...base, platform: 'react-native', commands: undefined },
      { dbPath: ':memory:' },
    );
    await expect(
      mobile.tools.reachability.start({ kind: 'ping', target: '127.0.0.1' }),
    ).rejects.toThrow(/desktop-only/);
  });

  it('builds port rows with HC preference, 32-bit fallback, and unknown speed', () => {
    expect(
      buildPortRows([
        { oid: '1.3.6.1.2.1.2.2.1.2.1', value: 'eth0' },
        { oid: '1.3.6.1.2.1.2.2.1.5.1', value: '0' },
        { oid: '1.3.6.1.2.1.2.2.1.10.1', value: '12' },
        { oid: '1.3.6.1.2.1.31.1.1.1.6.1', value: '999' },
      ]),
    ).toEqual([
      expect.objectContaining({ index: '1', name: 'eth0', inOctets: '999', highCapacity: true }),
    ]);
    expect(
      buildPortRows([
        { oid: '1.3.6.1.2.1.2.2.1.2.2', value: 'eth1' },
        { oid: '1.3.6.1.2.1.2.2.1.10.2', value: '7' },
      ])[0],
    ).toMatchObject({ inOctets: '7', highCapacity: false });
    expect(
      buildPortRows([{ oid: '1.3.6.1.2.1.2.2.1.2.3', value: 'eth2' }])[0]?.speedBitsPerSecond,
    ).toBeUndefined();
  });

  it('creates deduplicated HC or 32-bit port monitoring series', async () => {
    const engine = createEngine(createNodeTransport({ secrets: encryptedSecrets() }), {
      dbPath: ':memory:',
    });
    const agent = await savedAgent(engine);
    const first = await engine.tools.ports.monitor(agent.id, '7', true, 1_000);
    const second = await engine.tools.ports.monitor(agent.id, '7', true, 1_000);
    expect(first).toHaveLength(4);
    expect(second.map(({ id }) => id)).toEqual(first.map(({ id }) => id));
    expect(first).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          oid: '1.3.6.1.2.1.31.1.1.1.6.7',
          counterBits: 64,
          mode: 'rate-per-sec',
        }),
        expect.objectContaining({
          oid: '1.3.6.1.2.1.2.2.1.14.7',
          counterBits: 32,
          mode: 'rate-per-sec',
        }),
      ]),
    );
  });

  it('diffs persisted walk snapshots through the same aligned diff model', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'mibbeacon-snapshot-diff-'));
    const engine = createEngine(createNodeTransport({ dataDir }), { dbPath: ':memory:' });
    const a = await engine.ops.snapshots.create({
      name: 'before',
      agentName: 'fixture',
      baseOid: '1.3.6',
      results: [varbind('1.3.6.1', 'old', 'OctetString')],
    });
    const b = await engine.ops.snapshots.create({
      name: 'after',
      agentName: 'fixture',
      baseOid: '1.3.6',
      results: [
        varbind('1.3.6.1', 'new', 'OctetString'),
        varbind('1.3.6.2', 'added', 'OctetString'),
      ],
    });
    await expect(engine.tools.compare.snapshots(a.id, b.id)).resolves.toEqual([
      expect.objectContaining({
        oid: '1.3.6.1',
        status: 'different',
        valueA: 'old',
        valueB: 'new',
      }),
      expect.objectContaining({ oid: '1.3.6.2', status: 'only-b', valueB: 'added' }),
    ]);
  });
});
