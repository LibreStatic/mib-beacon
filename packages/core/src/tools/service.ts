import type { StorageAdapter, Transport } from '@mibbeacon/transport';
import type { MibStore } from '@mibbeacon/smi';
import type { DecodedVarbind, AgentSpec } from '../snmp/types';
import type {
  DiscoveryCredential,
  DiscoveryResult,
  PollChart,
  PollSample,
  PollSeries,
  PollSeriesDraft,
  PollWatch,
  PortViewRow,
  ToolsAPI,
  WalkDiffRow,
} from '../api/engine-api';
import type { EventBus } from '../events';
import type { AgentStore } from '../db/agent-store';
import type { QueryArtifactStore } from '../db/query-artifact-store';
import { SnmpSession } from '../snmp/session';
import { derivePollValue, interfaceUtilization, summarizeSamples } from './math';
import { diffWalks, parseNumericSnmpwalk, type WalkValue } from './diff';
import { expandIpv4Target } from './discovery';
import { buildPingArgs, parsePingSummary } from './reachability';

interface PollSeriesRow {
  id: string;
  name: string;
  agent_id: string;
  oid: string;
  interval_ms: number;
  mode: PollSeries['mode'];
  counter_bits: 32 | 64;
  retention: number;
  paused: number;
  error_count: number;
  next_due_at: number;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

interface PollSampleRow {
  id: number;
  series_id: string;
  sampled_at: number;
  raw_value: string;
  value: number | null;
  type_name: string | null;
}

export class ToolService {
  readonly api: ToolsAPI;
  private readonly pollTimers = new Map<string, ReturnType<typeof setInterval>>();
  private readonly pollInFlight = new Set<string>();
  private readonly operations = new Map<string, AbortController>();
  private readonly cancellationEvents = new Set<string>();
  private sequence = 0;

  constructor(
    private readonly transport: Transport,
    private readonly db: StorageAdapter,
    private readonly bus: EventBus,
    private readonly agents: AgentStore,
    private readonly mibStore: MibStore,
    private readonly artifacts: QueryArtifactStore,
    private readonly agentTester?: (agent: AgentSpec, oids: string[]) => Promise<DecodedVarbind[]>,
    private readonly now: () => number = Date.now,
  ) {
    this.api = this.buildApi();
    this.reschedulePolls();
  }

  private buildApi(): ToolsAPI {
    return {
      polls: {
        list: async () => this.listSeries(),
        create: async (draft) => this.createSeries(draft),
        update: async (id, patch) => this.updateSeries(id, patch),
        remove: async (id) => this.removeSeries(id),
        samples: async (id, limit) => this.listSamples(id, limit),
        sampleNow: async (ids) => this.sampleSeries(ids),
        exportCsv: async (id) => this.exportSeriesCsv(id),
      },
      watches: {
        list: async () => this.listWatches(),
        save: async (input) => this.saveWatch(input),
        remove: async (id) => {
          this.db.run('DELETE FROM poll_watches WHERE id = ?', [id]);
        },
      },
      charts: {
        list: async () => this.listCharts(),
        save: async (input) => this.saveChart(input),
        remove: async (id) => {
          this.db.run('DELETE FROM poll_charts WHERE id = ?', [id]);
        },
      },
      discovery: {
        start: async (input) => this.startDiscovery(input),
        cancel: async (handleId) => this.cancelOperation(handleId),
        saveAgent: async (input) => this.saveDiscoveredAgent(input),
      },
      compare: {
        live: async (input) => this.liveCompare(input.agentAId, input.agentBId, input.baseOid),
        start: async (input) => this.startCompare(input),
        cancel: async (handleId) => this.cancelOperation(handleId),
        text: async (a, b) => diffWalks(parseNumericSnmpwalk(a), parseNumericSnmpwalk(b)),
        snapshots: async (aId, bId) => this.compareSnapshots(aId, bId),
      },
      ports: {
        inspect: async (agentId) => this.inspectPorts(agentId),
        start: async (agentId) => this.startPortInspect(agentId),
        cancel: async (handleId) => this.cancelOperation(handleId),
        monitor: async (agentId, index, highCapacity, intervalMs) =>
          this.monitorPort(agentId, index, highCapacity, intervalMs),
      },
      reachability: {
        start: async (input) => this.startReachability(input),
        cancel: async (handleId) => this.cancelOperation(handleId),
      },
    };
  }

  private listSeries(): PollSeries[] {
    return this.db
      .all<PollSeriesRow>('SELECT * FROM poll_series ORDER BY name COLLATE NOCASE')
      .map(publicSeries);
  }

  private createSeries(draft: PollSeriesDraft): PollSeries {
    validateSeriesDraft(draft);
    const id = this.id('series');
    const at = this.now();
    this.db.run(
      `INSERT INTO poll_series
       (id,name,agent_id,oid,interval_ms,mode,counter_bits,retention,paused,error_count,next_due_at,last_error,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,0,?,NULL,?,?)`,
      [
        id,
        draft.name.trim(),
        draft.agentId,
        normalizeOid(draft.oid),
        Math.trunc(draft.intervalMs),
        draft.mode,
        draft.counterBits ?? 64,
        boundedRetention(draft.retention),
        draft.paused ? 1 : 0,
        at,
        at,
        at,
      ],
    );
    this.reschedulePolls();
    return this.requireSeries(id);
  }

  private updateSeries(id: string, patch: Partial<PollSeriesDraft>): PollSeries {
    const current = this.requireSeries(id);
    const next: PollSeriesDraft = {
      name: patch.name ?? current.name,
      agentId: patch.agentId ?? current.agentId,
      oid: patch.oid ?? current.oid,
      intervalMs: patch.intervalMs ?? current.intervalMs,
      mode: patch.mode ?? current.mode,
      counterBits: patch.counterBits ?? current.counterBits,
      retention: patch.retention ?? current.retention,
      paused: patch.paused ?? current.paused,
    };
    validateSeriesDraft(next);
    this.db.run(
      `UPDATE poll_series SET name=?,agent_id=?,oid=?,interval_ms=?,mode=?,counter_bits=?,retention=?,paused=?,next_due_at=?,updated_at=? WHERE id=?`,
      [
        next.name.trim(),
        next.agentId,
        normalizeOid(next.oid),
        Math.trunc(next.intervalMs),
        next.mode,
        next.counterBits ?? 64,
        boundedRetention(next.retention),
        next.paused ? 1 : 0,
        this.now(),
        this.now(),
        id,
      ],
    );
    this.reschedulePolls();
    return this.requireSeries(id);
  }

  private removeSeries(id: string): void {
    this.db.transaction(() => {
      this.db.run('DELETE FROM poll_samples WHERE series_id = ?', [id]);
      this.db.run('DELETE FROM poll_watches WHERE series_id = ?', [id]);
      this.db.run('DELETE FROM poll_series WHERE id = ?', [id]);
    });
    this.reschedulePolls();
  }

  private listSamples(seriesId: string, limit = 10_000): PollSample[] {
    const bounded = Math.max(1, Math.min(10_000, Math.trunc(limit)));
    return this.db
      .all<PollSampleRow>(
        'SELECT * FROM poll_samples WHERE series_id = ? ORDER BY sampled_at DESC, id DESC LIMIT ?',
        [seriesId, bounded],
      )
      .reverse()
      .map(publicSample);
  }

  private async sampleSeries(ids?: string[]): Promise<void> {
    const selected = this.listSeries().filter(
      (series) => !series.paused && (!ids || ids.includes(series.id)),
    );
    const groups = new Map<string, PollSeries[]>();
    for (const series of selected) {
      const group = groups.get(series.agentId) ?? [];
      group.push(series);
      groups.set(series.agentId, group);
    }
    await Promise.all([...groups.values()].map((series) => this.sampleGroup(series)));
  }

  private async sampleGroup(series: PollSeries[]): Promise<void> {
    if (series.length === 0) return;
    const now = this.now();
    const due = series.filter((item) => item.nextDueAt <= now);
    if (due.length === 0) return;
    try {
      const agent = await this.agents.resolve(due[0]!.agentId);
      const values = await this.get(
        agent,
        due.map((item) => item.oid),
      );
      const byOid = new Map(values.map((value) => [value.oid, value]));
      for (const item of due) {
        const varbind = byOid.get(item.oid);
        if (!varbind || varbind.isError)
          throw new Error(varbind?.errorText ?? `No value for ${item.oid}`);
        this.persistSample(item, varbind, now);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const item of due) {
        const errors = item.errorCount + 1;
        const backoff = item.intervalMs * 2 ** Math.min(5, Math.max(0, errors - 1));
        this.db.run(
          'UPDATE poll_series SET error_count=?,last_error=?,next_due_at=?,updated_at=? WHERE id=?',
          [errors, message, now + backoff, now, item.id],
        );
        this.bus.emit({
          channel: 'tools',
          kind: 'poll-error',
          payload: { seriesId: item.id, message, degraded: errors >= 3 },
        });
      }
    }
  }

  private persistSample(series: PollSeries, varbind: DecodedVarbind, at: number): void {
    const raw = String(varbind.rawValue ?? varbind.value);
    const previous = this.db.get<{ raw_value: string; sampled_at: number }>(
      'SELECT raw_value, sampled_at FROM poll_samples WHERE series_id=? ORDER BY sampled_at DESC,id DESC LIMIT 1',
      [series.id],
    );
    let value: number | null = null;
    try {
      value = derivePollValue(
        series.mode,
        raw,
        previous ? { raw: previous.raw_value, at: previous.sampled_at } : undefined,
        at,
        series.counterBits,
      );
    } catch {
      value = null;
    }
    this.db.run(
      'INSERT INTO poll_samples(series_id,sampled_at,raw_value,value,type_name) VALUES(?,?,?,?,?)',
      [series.id, at, raw, value, varbind.typeName],
    );
    this.db.run(
      'UPDATE poll_series SET error_count=0,last_error=NULL,next_due_at=?,updated_at=? WHERE id=?',
      [at + series.intervalMs, at, series.id],
    );
    this.pruneSamples(series.id, series.retention);
    const sample = this.db.get<PollSampleRow>(
      'SELECT * FROM poll_samples WHERE id=last_insert_rowid()',
    );
    if (!sample) return;
    const publicValue = publicSample(sample);
    this.bus.emit({ channel: 'tools', kind: 'sample', payload: publicValue });
    this.evaluateWatch(series.id, publicValue);
  }

  private pruneSamples(seriesId: string, retention: number): void {
    this.db.run(
      `DELETE FROM poll_samples WHERE series_id=? AND id NOT IN
       (SELECT id FROM poll_samples WHERE series_id=? ORDER BY sampled_at DESC,id DESC LIMIT ?)`,
      [seriesId, seriesId, retention],
    );
    this.db.run(
      `DELETE FROM poll_samples WHERE id IN
       (SELECT id FROM poll_samples ORDER BY sampled_at ASC,id ASC LIMIT
        MAX(0,(SELECT COUNT(*) FROM poll_samples)-250000))`,
    );
  }

  private exportSeriesCsv(id: string): string {
    this.requireSeries(id);
    const rows = ['timestamp,raw_value,value,type'];
    for (const sample of this.listSamples(id)) {
      rows.push(
        [
          new Date(sample.sampledAt).toISOString(),
          csv(sample.rawValue),
          sample.value ?? '',
          csv(sample.typeName ?? ''),
        ].join(','),
      );
    }
    return `${rows.join('\n')}\n`;
  }

  private listWatches(): PollWatch[] {
    return this.db
      .all<{
        id: string;
        series_id: string;
        name: string;
        operator: PollWatch['operator'] | null;
        threshold: number | null;
        threshold_mode: 'value' | 'raw';
        breaching: number;
      }>('SELECT * FROM poll_watches ORDER BY name COLLATE NOCASE')
      .map((row) => {
        const samples = this.listSamples(row.series_id, 10_000);
        const current = samples.at(-1);
        const stats = summarizeSamples(
          samples.flatMap((sample) => (sample.value === null ? [] : [sample.value])),
        );
        let lastChangeAt: number | undefined;
        for (let index = samples.length - 1; index > 0; index -= 1) {
          if (samples[index]?.rawValue !== samples[index - 1]?.rawValue) {
            lastChangeAt = samples[index]?.sampledAt;
            break;
          }
        }
        return {
          id: row.id,
          seriesId: row.series_id,
          name: row.name,
          ...(row.operator ? { operator: row.operator } : {}),
          ...(row.threshold === null ? {} : { threshold: row.threshold }),
          thresholdMode: row.threshold_mode,
          breaching: Boolean(row.breaching),
          ...(current ? { current } : {}),
          ...(stats ? { stats } : {}),
          ...(lastChangeAt === undefined ? {} : { lastChangeAt }),
        };
      });
  }

  private saveWatch(
    input: Omit<PollWatch, 'id' | 'breaching' | 'current' | 'stats' | 'lastChangeAt'> & {
      id?: string;
    },
  ): PollWatch {
    this.requireSeries(input.seriesId);
    if (!input.name.trim()) throw new Error('Watch name is required');
    if ((input.operator === undefined) !== (input.threshold === undefined)) {
      throw new Error('Watch threshold requires both an operator and numeric value');
    }
    const id = input.id ?? this.id('watch');
    const at = this.now();
    this.db.run(
      `INSERT INTO poll_watches(id,series_id,name,operator,threshold,threshold_mode,breaching,created_at,updated_at)
       VALUES(?,?,?,?,?,?,0,?,?) ON CONFLICT(id) DO UPDATE SET
       series_id=excluded.series_id,name=excluded.name,operator=excluded.operator,
       threshold=excluded.threshold,threshold_mode=excluded.threshold_mode,updated_at=excluded.updated_at`,
      [
        id,
        input.seriesId,
        input.name.trim(),
        input.operator ?? null,
        input.threshold ?? null,
        input.thresholdMode,
        at,
        at,
      ],
    );
    return this.listWatches().find((watch) => watch.id === id)!;
  }

  private evaluateWatch(seriesId: string, sample: PollSample): void {
    const row = this.db.get<{
      id: string;
      name: string;
      operator: PollWatch['operator'] | null;
      threshold: number | null;
      threshold_mode: 'value' | 'raw';
      breaching: number;
    }>('SELECT * FROM poll_watches WHERE series_id=?', [seriesId]);
    if (!row?.operator || row.threshold === null) return;
    const candidate = row.threshold_mode === 'raw' ? Number(sample.rawValue) : sample.value;
    const breaching =
      candidate !== null &&
      Number.isFinite(candidate) &&
      compareThreshold(candidate, row.operator, row.threshold);
    if (breaching === Boolean(row.breaching)) return;
    this.db.run('UPDATE poll_watches SET breaching=?,updated_at=? WHERE id=?', [
      breaching ? 1 : 0,
      this.now(),
      row.id,
    ]);
    if (breaching) {
      this.bus.emit({
        channel: 'tools',
        kind: 'watch-alert',
        payload: {
          watchId: row.id,
          name: row.name,
          seriesId,
          value: candidate,
          operator: row.operator,
          threshold: row.threshold,
        },
      });
    }
  }

  private listCharts(): PollChart[] {
    return this.db
      .all<{
        id: string;
        name: string;
        series_ids_json: string;
        hidden_series_ids_json: string;
        created_at: number;
        updated_at: number;
      }>('SELECT * FROM poll_charts ORDER BY name COLLATE NOCASE')
      .map((row) => ({
        id: row.id,
        name: row.name,
        seriesIds: JSON.parse(row.series_ids_json) as string[],
        hiddenSeriesIds: JSON.parse(row.hidden_series_ids_json) as string[],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
  }

  private saveChart(input: {
    id?: string;
    name: string;
    seriesIds: string[];
    hiddenSeriesIds?: string[];
  }): PollChart {
    const seriesIds = [...new Set(input.seriesIds)];
    if (!input.name.trim()) throw new Error('Chart name is required');
    if (seriesIds.length < 1 || seriesIds.length > 8)
      throw new Error('Charts require 1 to 8 series');
    for (const id of seriesIds) this.requireSeries(id);
    const id = input.id ?? this.id('chart');
    const at = this.now();
    this.db.run(
      `INSERT INTO poll_charts(id,name,series_ids_json,hidden_series_ids_json,created_at,updated_at)
       VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,
       series_ids_json=excluded.series_ids_json,hidden_series_ids_json=excluded.hidden_series_ids_json,updated_at=excluded.updated_at`,
      [
        id,
        input.name.trim(),
        JSON.stringify(seriesIds),
        JSON.stringify(input.hiddenSeriesIds ?? []),
        at,
        at,
      ],
    );
    return this.listCharts().find((chart) => chart.id === id)!;
  }

  private startDiscovery(input: {
    target: string;
    credentials: DiscoveryCredential[];
    concurrency?: number;
    allowLargeMobileRange?: boolean;
    prePing?: boolean;
  }): { handleId: string } {
    if (input.credentials.length === 0) throw new Error('Choose at least one discovery credential');
    const maxHosts =
      this.transport.platform === 'react-native' && !input.allowLargeMobileRange ? 254 : 65_536;
    const hosts = expandIpv4Target(input.target, { maxHosts });
    const handleId = this.operationId('discovery');
    const controller = new AbortController();
    this.operations.set(handleId, controller);
    void this.runDiscovery(
      handleId,
      hosts,
      input.credentials,
      Math.max(1, Math.min(64, input.concurrency ?? 32)),
      controller,
      Boolean(input.prePing),
    )
      .catch((error) => {
        if (controller.signal.aborted) {
          this.emitCancelled(handleId);
        } else {
          this.emitToolError(handleId, error);
        }
      })
      .finally(() => this.finishOperation(handleId));
    return { handleId };
  }

  private async runDiscovery(
    handleId: string,
    hosts: string[],
    credentials: DiscoveryCredential[],
    concurrency: number,
    controller: AbortController,
    prePing: boolean,
  ): Promise<void> {
    let cursor = 0;
    let found = 0;
    this.bus.emit({
      channel: 'tools',
      handleId,
      kind: 'discovery-started',
      payload: { total: hosts.length, concurrency },
    });
    const worker = async () => {
      while (!controller.signal.aborted) {
        const index = cursor++;
        const host = hosts[index];
        if (!host) return;
        const reachable =
          !prePing || !this.transport.commands
            ? true
            : await this.prePingHost(host, controller.signal);
        const result = reachable
          ? await this.probeHost(host, credentials, controller.signal)
          : null;
        if (result) {
          found += 1;
          this.bus.emit({ channel: 'tools', handleId, kind: 'discovery-result', payload: result });
        }
        this.bus.emit({
          channel: 'tools',
          handleId,
          kind: 'discovery-progress',
          payload: { completed: index + 1, total: hosts.length, found },
        });
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, hosts.length) }, worker));
    if (controller.signal.aborted) {
      this.emitCancelled(handleId);
    } else {
      this.bus.emit({
        channel: 'tools',
        handleId,
        kind: 'done',
        payload: { found, total: hosts.length },
      });
    }
  }

  private async prePingHost(host: string, signal: AbortSignal): Promise<boolean> {
    if (!this.transport.commands) return true;
    try {
      const result = await this.transport.commands.run(
        'ping',
        buildPingArgs(this.transport.hostOs, host, 1, 1_000),
        { signal },
      );
      return result.exitCode === 0;
    } catch {
      // Pre-ping is only an optimization. A missing/blocked ping binary must not
      // prevent the authoritative SNMP probe from running.
      return true;
    }
  }

  private async probeHost(
    host: string,
    credentials: DiscoveryCredential[],
    signal: AbortSignal,
  ): Promise<DiscoveryResult | null> {
    const oids = [
      '1.3.6.1.2.1.1.1.0',
      '1.3.6.1.2.1.1.2.0',
      '1.3.6.1.2.1.1.3.0',
      '1.3.6.1.2.1.1.5.0',
    ];
    for (const credential of credentials) {
      if (signal.aborted) return null;
      try {
        const template = credential.agentId
          ? await this.agents.resolve(credential.agentId)
          : {
              host,
              version: 'v2c' as const,
              community: credential.community ?? '',
              timeoutMs: 800,
              retries: 0,
            };
        const agent: AgentSpec = {
          ...template,
          host,
          timeoutMs: Math.min(template.timeoutMs ?? 800, 1_500),
          retries: 0,
        };
        const started = this.now();
        const values = await this.get(agent, oids);
        const byOid = new Map(
          values.map((value) => [value.oid, String(value.formattedValue ?? value.value)]),
        );
        return {
          ip: host,
          credentialLabel: credential.label,
          ...(credential.agentId ? { credentialAgentId: credential.agentId } : {}),
          version: agent.version,
          latencyMs: Math.max(0, this.now() - started),
          sysDescr: byOid.get(oids[0]!),
          sysObjectId: byOid.get(oids[1]!),
          sysUpTime: byOid.get(oids[2]!),
          sysName: byOid.get(oids[3]!),
        };
      } catch {
        // Try the next credential without disclosing its secret in events.
      }
    }
    return null;
  }

  private async saveDiscoveredAgent(input: {
    ip: string;
    name?: string;
    credentialAgentId?: string;
    community?: string;
  }) {
    const template = input.credentialAgentId
      ? await this.agents.resolve(input.credentialAgentId)
      : { host: input.ip, version: 'v2c' as const, community: input.community ?? '' };
    if (template.version !== 'v3' && !template.community) {
      throw new Error('A community or saved credential profile is required');
    }
    return this.agents.api.create({
      profile: {
        name: input.name?.trim() || input.ip,
        host: input.ip,
        port: template.port,
        transport: template.transport,
        version: template.version,
        timeoutMs: template.timeoutMs,
        retries: template.retries,
      },
      ...(template.v3
        ? {
            v3: {
              user: template.v3.user,
              level: template.v3.level,
              authProtocol: template.v3.authProtocol,
              privProtocol: template.v3.privProtocol,
              context: template.v3.context,
            },
          }
        : {}),
      secrets: {
        ...(template.community ? { community: template.community } : {}),
        ...(template.v3?.authKey ? { authKey: template.v3.authKey } : {}),
        ...(template.v3?.privKey ? { privKey: template.v3.privKey } : {}),
      },
    });
  }

  private async liveCompare(
    agentAId: string,
    agentBId: string,
    baseOid: string,
    signal?: AbortSignal,
  ): Promise<WalkDiffRow[]> {
    const [a, b] = await Promise.all([
      this.walkAgent(agentAId, baseOid, signal),
      this.walkAgent(agentBId, baseOid, signal),
    ]);
    return diffWalks(a, b);
  }

  private startCompare(input: { agentAId: string; agentBId: string; baseOid: string }): {
    handleId: string;
  } {
    const handleId = this.operationId('compare');
    const controller = new AbortController();
    this.operations.set(handleId, controller);
    void this.liveCompare(input.agentAId, input.agentBId, input.baseOid, controller.signal)
      .then((rows) => {
        if (controller.signal.aborted) return;
        this.bus.emit({ channel: 'tools', handleId, kind: 'compare-result', payload: rows });
        this.bus.emit({ channel: 'tools', handleId, kind: 'done', payload: { rows: rows.length } });
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          this.emitCancelled(handleId);
        } else {
          this.emitToolError(handleId, error);
        }
      })
      .finally(() => this.finishOperation(handleId));
    return { handleId };
  }

  private async compareSnapshots(aId: string, bId: string): Promise<WalkDiffRow[]> {
    const [a, b] = await Promise.all([
      this.artifacts.getSnapshot(aId),
      this.artifacts.getSnapshot(bId),
    ]);
    if (!a || !b) throw new Error('Both walk snapshots must exist');
    const convert = (snapshot: NonNullable<typeof a>): WalkValue[] =>
      snapshot.results.map((value) => ({
        oid: value.oid,
        value: String(value.formattedValue ?? value.value),
        type: value.typeName,
        ...(value.name ? { name: value.name } : {}),
      }));
    return diffWalks(convert(a), convert(b));
  }

  private async walkAgent(
    agentId: string,
    baseOid: string,
    signal?: AbortSignal,
  ): Promise<WalkValue[]> {
    const agent = await this.agents.resolve(agentId);
    const session = new SnmpSession(agent);
    const abort = () => session.close();
    signal?.addEventListener('abort', abort, { once: true });
    const rows: WalkValue[] = [];
    try {
      await session.walk(normalizeOid(baseOid), (batch) => {
        for (const value of batch) {
          const resolved = this.mibStore.index.resolve(value.oid);
          rows.push({
            oid: value.oid,
            value: String(value.formattedValue ?? value.value),
            type: value.typeName,
            ...(resolved ? { name: resolved.name } : {}),
          });
        }
      });
      return rows;
    } finally {
      signal?.removeEventListener('abort', abort);
      session.close();
    }
  }

  private async inspectPorts(agentId: string, signal?: AbortSignal): Promise<PortViewRow[]> {
    const [legacy, extended] = await Promise.all([
      this.walkAgent(agentId, '1.3.6.1.2.1.2.2.1', signal),
      this.walkAgent(agentId, '1.3.6.1.2.1.31.1.1.1', signal).catch(() => []),
    ]);
    return buildPortRows([...legacy, ...extended]).map((port) =>
      this.decoratePortRates(agentId, port),
    );
  }

  private startPortInspect(agentId: string): { handleId: string } {
    const handleId = this.operationId('ports');
    const controller = new AbortController();
    this.operations.set(handleId, controller);
    void this.inspectPorts(agentId, controller.signal)
      .then((rows) => {
        if (controller.signal.aborted) return;
        this.bus.emit({ channel: 'tools', handleId, kind: 'ports-result', payload: rows });
        this.bus.emit({
          channel: 'tools',
          handleId,
          kind: 'done',
          payload: { ports: rows.length },
        });
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          this.emitCancelled(handleId);
        } else {
          this.emitToolError(handleId, error);
        }
      })
      .finally(() => this.finishOperation(handleId));
    return { handleId };
  }

  private monitorPort(
    agentId: string,
    index: string,
    highCapacity: boolean,
    intervalMs = 5_000,
  ): PollSeries[] {
    if (!/^\d+$/.test(index)) throw new Error('Port index must be numeric');
    const inputs = [
      {
        name: `if${index} inbound`,
        oid: `${highCapacity ? '1.3.6.1.2.1.31.1.1.1.6' : '1.3.6.1.2.1.2.2.1.10'}.${index}`,
        bits: highCapacity ? 64 : 32,
      },
      {
        name: `if${index} outbound`,
        oid: `${highCapacity ? '1.3.6.1.2.1.31.1.1.1.10' : '1.3.6.1.2.1.2.2.1.16'}.${index}`,
        bits: highCapacity ? 64 : 32,
      },
      { name: `if${index} input errors`, oid: `1.3.6.1.2.1.2.2.1.14.${index}`, bits: 32 },
      { name: `if${index} output errors`, oid: `1.3.6.1.2.1.2.2.1.20.${index}`, bits: 32 },
    ];
    return inputs.map((input) => {
      const existing = this.listSeries().find(
        (series) => series.agentId === agentId && series.oid === input.oid,
      );
      return (
        existing ??
        this.createSeries({
          name: input.name,
          agentId,
          oid: input.oid,
          intervalMs,
          mode: 'rate-per-sec',
          counterBits: input.bits as 32 | 64,
        })
      );
    });
  }

  private decoratePortRates(agentId: string, port: PortViewRow): PortViewRow {
    const series = this.listSeries().filter(
      (item) => item.agentId === agentId && item.oid.endsWith(`.${port.index}`),
    );
    const latest = (needle: string) => {
      const match = series.find((item) => item.oid.includes(needle));
      return match ? (this.listSamples(match.id, 1).at(-1)?.value ?? undefined) : undefined;
    };
    const inOctetsPerSecond = latest(port.highCapacity ? '.31.1.1.1.6.' : '.2.2.1.10.');
    const outOctetsPerSecond = latest(port.highCapacity ? '.31.1.1.1.10.' : '.2.2.1.16.');
    const inErrorRate = latest('.2.2.1.14.');
    const outErrorRate = latest('.2.2.1.20.');
    const inUtilization =
      inOctetsPerSecond === undefined || !port.speedBitsPerSecond
        ? null
        : interfaceUtilization(inOctetsPerSecond, port.speedBitsPerSecond);
    const outUtilization =
      outOctetsPerSecond === undefined || !port.speedBitsPerSecond
        ? null
        : interfaceUtilization(outOctetsPerSecond, port.speedBitsPerSecond);
    return {
      ...port,
      ...(inOctetsPerSecond === undefined ? {} : { inBitsPerSecond: inOctetsPerSecond * 8 }),
      ...(outOctetsPerSecond === undefined ? {} : { outBitsPerSecond: outOctetsPerSecond * 8 }),
      ...(inUtilization === null ? {} : { inUtilizationPercent: inUtilization }),
      ...(outUtilization === null ? {} : { outUtilizationPercent: outUtilization }),
      ...(inErrorRate === undefined ? {} : { inErrorRate }),
      ...(outErrorRate === undefined ? {} : { outErrorRate }),
    };
  }

  private startReachability(input: {
    kind: 'ping' | 'traceroute';
    target: string;
    count?: number;
    intervalMs?: number;
  }): { handleId: string } {
    if (!/^[A-Za-z0-9._:%-]+$/.test(input.target))
      throw new Error('Reachability target contains invalid characters');
    if (!this.transport.commands) {
      throw new Error('ICMP ping and traceroute are desktop-only; use SNMP discovery on mobile');
    }
    const handleId = this.operationId(input.kind);
    const controller = new AbortController();
    this.operations.set(handleId, controller);
    const windows = this.transport.hostOs === 'win32';
    const command = input.kind === 'ping' ? 'ping' : windows ? 'tracert' : 'traceroute';
    const args =
      input.kind === 'ping'
        ? buildPingArgs(this.transport.hostOs, input.target, input.count, input.intervalMs)
        : windows
          ? ['-d', input.target]
          : ['-n', input.target];
    const lines: string[] = [];
    const options = {
      signal: controller.signal,
      onLine: (line: string, stream: 'stdout' | 'stderr') => {
        lines.push(line);
        this.bus.emit({
          channel: 'tools',
          handleId,
          kind: 'reachability-line',
          payload: { line, stream },
        });
      },
    } as const;
    let run = this.transport.commands.run(command, args, options);
    if (input.kind === 'traceroute' && !windows) {
      run = run.catch(() =>
        this.transport.commands!.run('tracepath', ['-n', input.target], options),
      );
    }
    void run
      .then((result) => {
        if (controller.signal.aborted) {
          this.emitCancelled(handleId);
        } else {
          this.bus.emit({
            channel: 'tools',
            handleId,
            kind: 'done',
            payload: {
              ...result,
              ...(input.kind === 'ping' ? { summary: parsePingSummary(lines) } : {}),
            },
          });
        }
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          this.emitCancelled(handleId);
        } else {
          this.emitToolError(handleId, error);
        }
      })
      .finally(() => this.finishOperation(handleId));
    return { handleId };
  }

  private cancelOperation(handleId: string): void {
    const controller = this.operations.get(handleId);
    if (!controller) return;
    controller.abort();
    this.emitCancelled(handleId);
  }

  private emitCancelled(handleId: string): void {
    if (this.cancellationEvents.has(handleId)) return;
    this.cancellationEvents.add(handleId);
    this.bus.emit({ channel: 'tools', handleId, kind: 'cancelled', payload: {} });
  }

  private finishOperation(handleId: string): void {
    this.operations.delete(handleId);
    this.cancellationEvents.delete(handleId);
  }

  private async get(agent: AgentSpec, oids: string[]): Promise<DecodedVarbind[]> {
    if (this.agentTester) return this.agentTester(agent, oids);
    const session = new SnmpSession(agent);
    try {
      return await session.get(oids);
    } finally {
      session.close();
    }
  }

  private requireSeries(id: string): PollSeries {
    const row = this.db.get<PollSeriesRow>('SELECT * FROM poll_series WHERE id=?', [id]);
    if (!row) throw new Error(`Poll series ${id} does not exist`);
    return publicSeries(row);
  }

  private reschedulePolls(): void {
    for (const timer of this.pollTimers.values()) clearInterval(timer);
    this.pollTimers.clear();
    const groups = new Map<string, PollSeries[]>();
    for (const series of this.listSeries().filter((item) => !item.paused)) {
      const key = `${series.agentId}:${series.intervalMs}`;
      const group = groups.get(key) ?? [];
      group.push(series);
      groups.set(key, group);
    }
    for (const [key, group] of groups) {
      const interval = Math.max(250, Math.min(...group.map((series) => series.intervalMs)));
      const agentId = group[0]!.agentId;
      const timer = setInterval(() => {
        if (this.pollInFlight.has(key)) return;
        const fresh = this.listSeries().filter(
          (series) =>
            !series.paused && series.agentId === agentId && series.intervalMs === interval,
        );
        if (fresh.length === 0) return;
        this.pollInFlight.add(key);
        void this.sampleGroup(fresh).finally(() => this.pollInFlight.delete(key));
      }, interval);
      unref(timer);
      this.pollTimers.set(key, timer);
    }
  }

  private operationId(kind: string): string {
    return `${kind}-${this.now()}-${this.sequence++}`;
  }

  private emitToolError(handleId: string, error: unknown): void {
    this.bus.emit({
      channel: 'tools',
      handleId,
      kind: 'error',
      payload: { message: error instanceof Error ? error.message : String(error) },
    });
  }

  private id(prefix: string): string {
    return `${prefix}-${[...this.transport.crypto.randomBytes(10)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  }
}

function publicSeries(row: PollSeriesRow): PollSeries {
  return {
    id: row.id,
    name: row.name,
    agentId: row.agent_id,
    oid: row.oid,
    intervalMs: row.interval_ms,
    mode: row.mode,
    counterBits: row.counter_bits,
    retention: row.retention,
    paused: Boolean(row.paused),
    errorCount: row.error_count,
    nextDueAt: row.next_due_at,
    ...(row.last_error ? { lastError: row.last_error } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function publicSample(row: PollSampleRow): PollSample {
  return {
    id: row.id,
    seriesId: row.series_id,
    sampledAt: row.sampled_at,
    rawValue: row.raw_value,
    value: row.value,
    ...(row.type_name ? { typeName: row.type_name } : {}),
  };
}

function validateSeriesDraft(draft: PollSeriesDraft): void {
  if (!draft.name.trim()) throw new Error('Series name is required');
  if (!draft.agentId) throw new Error('Series agent is required');
  normalizeOid(draft.oid);
  if (!Number.isFinite(draft.intervalMs) || draft.intervalMs < 250)
    throw new Error('Poll interval must be at least 250 ms');
  if (!['raw', 'delta', 'rate-per-sec'].includes(draft.mode)) throw new Error('Invalid poll mode');
}

function normalizeOid(oid: string): string {
  const value = oid.trim().replace(/^\./, '');
  if (!/^\d+(?:\.\d+)+$/.test(value)) throw new Error(`Invalid numeric OID: ${oid}`);
  return value;
}

function boundedRetention(value?: number): number {
  return Math.max(10, Math.min(100_000, Math.trunc(value ?? 10_000)));
}

function csv(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function compareThreshold(
  value: number,
  operator: NonNullable<PollWatch['operator']>,
  threshold: number,
): boolean {
  if (operator === '>') return value > threshold;
  if (operator === '<') return value < threshold;
  if (operator === '==') return value === threshold;
  return value !== threshold;
}

function unref(timer: ReturnType<typeof setInterval>): void {
  if (typeof timer === 'object' && timer && 'unref' in timer) {
    (timer as unknown as { unref(): void }).unref();
  }
}

export function buildPortRows(values: WalkValue[]): PortViewRow[] {
  const columns = new Map<string, Map<string, string>>();
  const add = (base: string, column: string, index: string, value: string) => {
    const row = columns.get(index) ?? new Map<string, string>();
    row.set(`${base}:${column}`, value);
    columns.set(index, row);
  };
  for (const value of values) {
    let match = /^1\.3\.6\.1\.2\.1\.2\.2\.1\.(\d+)\.(.+)$/.exec(value.oid);
    if (match?.[1] && match[2]) add('if', match[1], match[2], value.value);
    match = /^1\.3\.6\.1\.2\.1\.31\.1\.1\.1\.(\d+)\.(.+)$/.exec(value.oid);
    if (match?.[1] && match[2]) add('ifx', match[1], match[2], value.value);
  }
  return [...columns.entries()]
    .map(([index, row]) => {
      const highCapacity = row.has('ifx:6') || row.has('ifx:10');
      const highSpeed = Number(row.get('ifx:15')) * 1_000_000;
      const legacySpeed = Number(row.get('if:5'));
      return {
        index,
        name: row.get('ifx:1') ?? row.get('if:2') ?? `if${index}`,
        ...(row.get('ifx:18') ? { alias: row.get('ifx:18') } : {}),
        ...(Number.isFinite(Number(row.get('if:7')))
          ? { adminStatus: Number(row.get('if:7')) }
          : {}),
        ...(Number.isFinite(Number(row.get('if:8')))
          ? { operStatus: Number(row.get('if:8')) }
          : {}),
        ...(Number.isFinite(highSpeed) && highSpeed > 0
          ? { speedBitsPerSecond: highSpeed }
          : Number.isFinite(legacySpeed) && legacySpeed > 0
            ? { speedBitsPerSecond: legacySpeed }
            : {}),
        ...(row.get(highCapacity ? 'ifx:6' : 'if:10')
          ? { inOctets: row.get(highCapacity ? 'ifx:6' : 'if:10') }
          : {}),
        ...(row.get(highCapacity ? 'ifx:10' : 'if:16')
          ? { outOctets: row.get(highCapacity ? 'ifx:10' : 'if:16') }
          : {}),
        ...(row.get('if:14') ? { inErrors: row.get('if:14') } : {}),
        ...(row.get('if:20') ? { outErrors: row.get('if:20') } : {}),
        highCapacity,
      };
    })
    .sort((a, b) => Number(a.index) - Number(b.index));
}
