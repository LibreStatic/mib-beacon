import { Buffer } from 'buffer';
import type { FileStore, StorageAdapter, UdpSocketFactory } from '@mibbeacon/transport';
import type { MibStore, MibNodeDetail } from '@mibbeacon/smi';
import { getSetting, setSetting } from '../db/migrate';
import { MibBeaconError } from '../errors';
import type { EventBus } from '../events';
import type { AgentSpec, DecodedVarbind, SnmpVarbindInput } from '../snmp/types';
import type {
  AgentTarget,
  LiveMibScanRequest,
  LiveMibScanStatus,
  LiveMibSettings,
  LiveMibsAPI,
  LiveMibUpload,
  LiveMibWorkflowCandidate,
  LiveMibWorkflowDetection,
  LiveMibWorkflowRequest,
  LiveMibWorkflowStatus,
} from '../api/engine-api';

export const DEFAULT_LIVE_MIB_SETTINGS: LiveMibSettings = {
  refreshMode: 'adaptive',
  refreshIntervalMs: 5_000,
  staleAfterMs: 15_000,
  pauseWhenHidden: true,
  scanConcurrency: 1,
  maxInstances: 100_000,
  showReadOnly: false,
  writeMode: 'confirm',
  writeDebounceMs: 500,
  verifyWrites: true,
  booleanEditor: 'auto',
  preferFormattedValues: true,
  managedTransfersEnabled: false,
  maximumUploadBytes: 65_535,
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Math.round(value)));

export function normalizeLiveMibSettings(
  patch: Partial<LiveMibSettings> = {},
): LiveMibSettings {
  const merged = { ...DEFAULT_LIVE_MIB_SETTINGS, ...patch };
  return {
    ...merged,
    scanConcurrency: clamp(merged.scanConcurrency, 1, 8),
    refreshIntervalMs: clamp(merged.refreshIntervalMs, 500, 300_000),
    staleAfterMs: clamp(merged.staleAfterMs, 500, 3_600_000),
    maxInstances: clamp(merged.maxInstances, 1, 1_000_000),
    writeDebounceMs: clamp(merged.writeDebounceMs, 0, 2_000),
    maximumUploadBytes: clamp(merged.maximumUploadBytes, 1, 1_073_741_824),
  };
}

interface InternalUpload extends LiveMibUpload {
  path: string;
  expiresAt: number;
}

const UPLOAD_TTL_MS = 15 * 60_000;

interface LiveMibServiceOperations {
  resolveAgent(target: AgentTarget): Promise<AgentSpec>;
  get(agent: AgentSpec, oids: string[]): Promise<DecodedVarbind[]>;
  walk(
    agent: AgentSpec,
    oid: string,
    onBatch: (batch: DecodedVarbind[]) => void,
    signal: AbortSignal,
  ): Promise<void>;
  set(agent: AgentSpec, varbinds: SnmpVarbindInput[]): Promise<DecodedVarbind[]>;
  decorate(varbinds: DecodedVarbind[]): DecodedVarbind[];
}

interface ScanTask {
  oid: string;
  kind: 'get' | 'walk';
}

export class LiveMibService {
  readonly api: LiveMibsAPI;
  private readonly uploads = new Map<string, InternalUpload>();
  private readonly scans = new Map<string, LiveMibScanStatus>();
  private readonly scanControllers = new Map<string, AbortController>();
  private readonly workflows = new Map<string, LiveMibWorkflowStatus>();
  private readonly workflowControllers = new Map<string, AbortController>();
  private sequence = 0;

  constructor(
    private readonly db: StorageAdapter,
    private readonly files: FileStore,
    private readonly udp: UdpSocketFactory,
    private readonly mibStore: MibStore,
    private readonly bus: EventBus,
    private readonly operations: LiveMibServiceOperations,
  ) {
    this.api = {
      settings: {
        get: async () => this.settings(),
        update: async (patch) => {
          const value = normalizeLiveMibSettings({ ...this.settings(), ...patch });
          setSetting(this.db, 'live-mibs.settings', value);
          return value;
        },
      },
      agentOverrides: {
        get: async (agentId) =>
          getSetting<Partial<LiveMibSettings>>(this.db, this.agentKey(agentId)) ?? null,
        update: async (agentId, patch) => {
          const current =
            getSetting<Partial<LiveMibSettings>>(this.db, this.agentKey(agentId)) ?? {};
          const normalized = this.normalizeOverride({ ...current, ...patch });
          setSetting(this.db, this.agentKey(agentId), normalized);
          return normalized;
        },
        reset: async (agentId) => {
          this.db.run('DELETE FROM settings WHERE key = ?', [this.agentKey(agentId)]);
        },
      },
      scan: {
        start: async (request) => this.startScan(request),
        status: async (handleId) => this.scans.get(handleId) ?? null,
        cancel: async (handleId) => this.cancelScan(handleId),
      },
      writeCell: async (request) => {
        this.validateMibVarbind(request.varbind);
        const agent = await this.operations.resolveAgent(request);
        const [setValue] = this.operations.decorate(
          await this.operations.set(agent, [request.varbind]),
        );
        if (!setValue)
          throw new MibBeaconError('REQ_FAILED', 'The agent returned no value for the Set');
        if (request.verify === false) return { value: setValue, verified: false };
        const [verified] = this.operations.decorate(
          await this.operations.get(agent, [request.varbind.oid]),
        );
        if (!verified)
          throw new MibBeaconError('REQ_FAILED', 'The Set completed but verification returned no value');
        if (!this.matchesRequestedValue(request.varbind, verified))
          throw new MibBeaconError(
            'REQ_FAILED',
            `Device read-back ${this.varbindText(verified)} differs from requested ${request.varbind.value}`,
          );
        return { value: verified, verified: true };
      },
      uploads: {
        create: async (input) => this.createUpload(input),
        append: async (id, offset, base64) => this.appendUpload(id, offset, base64),
        complete: async (id) => this.completeUpload(id),
        status: async (id) => {
          await this.cleanupExpiredUploads();
          return this.publicUpload(this.uploads.get(id));
        },
        dispose: async (id) => this.disposeUpload(id),
      },
      workflows: {
        detect: async (input) => detectLiveMibWorkflows(input),
        start: async (request) => this.startWorkflow(request),
        status: async (handleId) => this.workflows.get(handleId) ?? null,
        cancel: async (handleId) => this.workflowControllers.get(handleId)?.abort(),
      },
    };
  }

  private matchesRequestedValue(
    requested: SnmpVarbindInput,
    verified: DecodedVarbind,
  ): boolean {
    if (
      /^(?:Integer|Integer32|Unsigned32|Counter32|Counter64|Gauge32|TimeTicks)$/.test(
        requested.type,
      )
    )
      return Number(verified.rawValue ?? verified.value) === Number(requested.value);
    if (requested.encoding === 'hex') {
      const expected = requested.value.replace(/^0x/i, '').replace(/[\s:-]/g, '').toLowerCase();
      const actual = verified.rawHex ?? verified.rawValue ?? verified.value;
      const actualHex =
        Buffer.isBuffer(actual)
          ? Buffer.from(actual).toString('hex')
          : String(actual).replace(/^0x/i, '').replace(/[\s:-]/g, '').toLowerCase();
      return actualHex === expected;
    }
    return String(verified.value) === requested.value;
  }

  private varbindText(varbind: DecodedVarbind): string {
    const value = varbind.value;
    return Buffer.isBuffer(value) ? Buffer.from(value).toString('hex') : String(value);
  }

  private validateMibVarbind(varbind: SnmpVarbindInput): void {
    const resolved = this.mibStore.index.resolve(varbind.oid);
    const detail = resolved ? this.mibStore.index.node(resolved.definitionOid) : null;
    if (!detail) return;
    if (detail.numericRanges?.length && /^-?\d+$/.test(varbind.value.trim())) {
      const numeric = Number(varbind.value);
      if (!detail.numericRanges.some(({ min, max }) => numeric >= min && numeric <= max))
        throw new MibBeaconError(
          'SET_WRONG_TYPE',
          `Value must satisfy the MIB range ${detail.numericRanges
            .map(({ min, max }) => `${min}..${max}`)
            .join(' or ')}`,
        );
    }
    if (detail.sizeRanges?.length && (varbind.type === 'OctetString' || varbind.type === 'Opaque')) {
      const byteLength =
        varbind.encoding === 'hex'
          ? varbind.value.replace(/^0x/i, '').replace(/[\s:-]/g, '').length / 2
          : new TextEncoder().encode(varbind.value).length;
      if (!detail.sizeRanges.some(({ min, max }) => byteLength >= min && byteLength <= max))
        throw new MibBeaconError(
          'SET_WRONG_TYPE',
          `Value must satisfy the MIB size ${detail.sizeRanges
            .map(({ min, max }) => `${min}..${max} bytes`)
            .join(' or ')}`,
        );
    }
  }

  private async startScan(request: LiveMibScanRequest): Promise<{ handleId: string }> {
    const settings = this.settings();
    const handleId = `live-scan-${Date.now()}-${this.sequence++}`;
    const startedAt = Date.now();
    const tasks = this.scanTasks(
      request.scopeOid,
      request.includeReadOnly ?? settings.showReadOnly,
      request.preferredOids,
    );
    const status: LiveMibScanStatus = {
      handleId,
      state: 'started',
      scopeOid: request.scopeOid,
      taskCount: tasks.length,
      completedTasks: 0,
      count: 0,
      startedAt,
      updatedAt: startedAt,
      errors: [],
    };
    const controller = new AbortController();
    this.scans.set(handleId, status);
    this.scanControllers.set(handleId, controller);
    // Remote bridges cannot associate events with this handle until the start
    // result has reached the caller. Defer every scan event to the next task so
    // even a fast scalar read cannot publish its batch before that result.
    setTimeout(() => {
      this.emitScan(status, 'started');
      void this.runScan(
        request,
        tasks,
        status,
        controller,
        clamp(request.concurrency ?? settings.scanConcurrency, 1, 8),
        clamp(request.maxInstances ?? settings.maxInstances, 1, 1_000_000),
      );
    }, 0);
    return { handleId };
  }

  private async runScan(
    request: LiveMibScanRequest,
    tasks: ScanTask[],
    status: LiveMibScanStatus,
    controller: AbortController,
    concurrency: number,
    maxInstances: number,
  ): Promise<void> {
    status.state = 'running';
    status.updatedAt = Date.now();
    this.emitScan(status, 'progress');
    let next = 0;
    let limitReached = false;
    try {
      const agent = await this.operations.resolveAgent(request);
      const worker = async () => {
        while (next < tasks.length && !controller.signal.aborted && status.count < maxInstances) {
          const task = tasks[next++]!;
          try {
            if (task.kind === 'get') {
              const batch = this.operations.decorate(await this.operations.get(agent, [task.oid]));
              this.acceptBatch(status, batch.slice(0, Math.max(0, maxInstances - status.count)));
            } else {
              await this.operations.walk(
                agent,
                task.oid,
                (batch) => {
                  this.acceptBatch(
                    status,
                    this.operations
                      .decorate(batch)
                      .slice(0, Math.max(0, maxInstances - status.count)),
                  );
                  if (status.count >= maxInstances) {
                    limitReached = true;
                    controller.abort();
                  }
                },
                controller.signal,
              );
            }
          } catch (error) {
            if (!controller.signal.aborted)
              status.errors.push({
                oid: task.oid,
                message: error instanceof Error ? error.message : String(error),
              });
          } finally {
            status.completedTasks += 1;
            status.updatedAt = Date.now();
            this.emitScan(status, 'progress');
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(concurrency, Math.max(tasks.length, 1)) }, worker),
      );
      status.state = controller.signal.aborted && !limitReached
        ? 'cancelled'
        : status.errors.length === 0
          ? 'done'
          : status.count > 0
            ? 'partial'
            : 'error';
    } catch (error) {
      status.errors.push({
        oid: request.scopeOid,
        message: error instanceof Error ? error.message : String(error),
      });
      status.state = controller.signal.aborted ? 'cancelled' : 'error';
    } finally {
      status.updatedAt = Date.now();
      this.scanControllers.delete(status.handleId);
      this.emitScan(status, status.state);
    }
  }

  private acceptBatch(status: LiveMibScanStatus, batch: DecodedVarbind[]): void {
    if (batch.length === 0) return;
    status.count += batch.length;
    status.updatedAt = Date.now();
    this.bus.emit({
      channel: 'live-mibs',
      handleId: status.handleId,
      kind: 'batch',
      payload: batch,
    });
  }

  private cancelScan(handleId: string): void {
    this.scanControllers.get(handleId)?.abort();
  }

  private emitScan(status: LiveMibScanStatus, kind: string): void {
    this.bus.emit({
      channel: 'live-mibs',
      handleId: status.handleId,
      kind,
      payload: { ...status, errors: [...status.errors] },
    });
  }

  private scanTasks(
    scopeOid: string,
    includeReadOnly: boolean,
    preferredOids: string[] = [],
  ): ScanTask[] {
    const tasks: ScanTask[] = [];
    const visit = (oid: string) => {
      const detail = this.mibStore.index.node(oid);
      if (detail && (detail.kind === 'scalar' || detail.kind === 'column')) {
        if (this.isReadable(detail) && (includeReadOnly || this.isWritable(detail))) {
          tasks.push({
            oid: detail.kind === 'scalar' ? `${detail.oid}.0` : detail.oid,
            kind: detail.kind === 'scalar' ? 'get' : 'walk',
          });
        }
        return;
      }
      for (const child of this.mibStore.index.children(oid)) visit(child.oid);
    };
    visit(scopeOid);
    const preference = new Map(preferredOids.map((oid, index) => [oid, index]));
    return tasks.sort((left, right) => {
      const leftRank = preference.get(left.oid) ?? Number.MAX_SAFE_INTEGER;
      const rightRank = preference.get(right.oid) ?? Number.MAX_SAFE_INTEGER;
      return leftRank - rightRank;
    });
  }

  private isReadable(detail: MibNodeDetail): boolean {
    return detail.access !== 'not-accessible' && detail.access !== 'write-only';
  }

  private isWritable(detail: MibNodeDetail): boolean {
    return /read-write|read-create/i.test(detail.access ?? '');
  }

  private settings(): LiveMibSettings {
    return normalizeLiveMibSettings(
      getSetting<Partial<LiveMibSettings>>(this.db, 'live-mibs.settings'),
    );
  }

  private async startWorkflow(
    request: LiveMibWorkflowRequest,
  ): Promise<{ handleId: string }> {
    const upload = this.requireUpload(request.uploadId);
    if (upload.state !== 'ready')
      throw new MibBeaconError('REQ_FAILED', 'Complete the upload before starting a workflow');
    const handleId = `live-workflow-${Date.now()}-${this.sequence++}`;
    const startedAt = Date.now();
    const status: LiveMibWorkflowStatus = {
      handleId,
      adapterId: request.adapterId,
      state: 'preparing',
      uploadName: upload.name,
      totalBytes: upload.byteLength,
      sentBytes: 0,
      startedAt,
      updatedAt: startedAt,
    };
    const controller = new AbortController();
    this.workflows.set(handleId, status);
    this.workflowControllers.set(handleId, controller);
    this.emitWorkflow(status);
    void this.runWorkflow(request, upload, status, controller);
    return { handleId };
  }

  private async runWorkflow(
    request: LiveMibWorkflowRequest,
    upload: InternalUpload,
    status: LiveMibWorkflowStatus,
    controller: AbortController,
  ): Promise<void> {
    try {
      const agent = await this.operations.resolveAgent(request);
      const bytes = await this.files.readBytes(upload.path);
      if (controller.signal.aborted) return;
      if (request.adapterId === 'direct-binary') {
        if (!request.direct)
          throw new MibBeaconError('REQ_FAILED', 'Direct binary workflow requires an OID and type');
        status.state = 'transferring';
        this.emitWorkflow(status);
        const value: SnmpVarbindInput = {
          oid: request.direct.oid,
          type: request.direct.type,
          value: Buffer.from(bytes).toString('hex'),
          encoding: 'hex',
        };
        this.validateMibVarbind(value);
        await this.operations.set(agent, [value]);
        status.sentBytes = bytes.length;
      } else if (request.adapterId === 'timed-block-stream') {
        if (!request.block)
          throw new MibBeaconError('REQ_FAILED', 'Timed block workflow requires block settings');
        const chunkSize = clamp(request.block.chunkSize, 1, 65_535);
        if (request.block.credentialVarbinds?.length) {
          status.state = 'authenticating';
          this.emitWorkflow(status);
          await this.operations.set(agent, request.block.credentialVarbinds);
        }
        if (request.block.startVarbinds?.length)
          await this.operations.set(agent, request.block.startVarbinds);
        status.state = 'transferring';
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
          if (controller.signal.aborted) break;
          const chunk = bytes.slice(offset, Math.min(bytes.length, offset + chunkSize));
          await this.operations.set(agent, [
            {
              oid: request.block.blockOid,
              type: request.block.type ?? 'OctetString',
              value: Buffer.from(chunk).toString('hex'),
              encoding: 'hex',
            },
          ]);
          status.sentBytes += chunk.length;
          status.updatedAt = Date.now();
          this.emitWorkflow(status);
        }
        if (!controller.signal.aborted && request.block.eof && request.block.eof !== 'none') {
          await this.operations.set(agent, [
            {
              oid: request.block.blockOid,
              type: request.block.type ?? 'OctetString',
              value: request.block.eof === 'nul' ? '00' : '',
              encoding: 'hex',
            },
          ]);
        }
        if (!controller.signal.aborted && request.block.finishVarbinds?.length) {
          status.state = 'processing';
          this.emitWorkflow(status);
          await this.operations.set(agent, request.block.finishVarbinds);
        }
      } else {
        if (!request.controlVarbinds?.length)
          throw new MibBeaconError(
            'REQ_FAILED',
            'Cisco transfer control requires protocol, server, file-name, and RowStatus varbinds',
          );
        if (!this.settingsForAgent(request.agentId).managedTransfersEnabled)
          throw new MibBeaconError(
            'REQ_FAILED',
            'Managed transfers are disabled in Live MIB settings',
          );
        status.state = 'processing';
        this.emitWorkflow(status);
        await this.serveManagedTftp(
          bytes,
          upload.name,
          agent.host,
          request.managedTransfer,
          status,
          controller.signal,
          async () => {
            await this.operations.set(agent, request.controlVarbinds!);
          },
        );
      }
      if (controller.signal.aborted) {
        status.state = 'cancelled';
      } else if (request.verifyOid) {
        status.state = 'verifying';
        this.emitWorkflow(status);
        await this.operations.get(agent, [request.verifyOid]);
        status.state = 'done';
      } else {
        status.state = 'done';
      }
    } catch (error) {
      status.state = controller.signal.aborted ? 'cancelled' : 'error';
      status.message = error instanceof Error ? error.message : String(error);
    } finally {
      status.updatedAt = Date.now();
      this.workflowControllers.delete(status.handleId);
      this.emitWorkflow(status);
    }
  }

  private emitWorkflow(status: LiveMibWorkflowStatus): void {
    this.bus.emit({
      channel: 'live-mibs',
      handleId: status.handleId,
      kind: 'workflow',
      payload: { ...status },
    });
  }

  private async serveManagedTftp(
    bytes: Uint8Array,
    fileName: string,
    agentHost: string,
    options: LiveMibWorkflowRequest['managedTransfer'],
    status: LiveMibWorkflowStatus,
    signal: AbortSignal,
    trigger: () => Promise<void>,
  ): Promise<void> {
    const socket = this.udp.create('udp4');
    const bindAddress = options?.bindAddress ?? '0.0.0.0';
    const port = clamp(options?.port ?? 69, 0, 65_535);
    const timeoutMs = clamp(options?.timeoutMs ?? 120_000, 1_000, 30 * 60_000);
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let removeMessage = () => {};
    let removeError = () => {};
    let rejectTransfer: (error: Error) => void = () => {};
    const close = async () => {
      if (timer) clearTimeout(timer);
      removeMessage();
      removeError();
      signal.removeEventListener('abort', abort);
      await socket.close().catch(() => undefined);
    };
    const abort = () => rejectTransfer(new Error('Managed transfer cancelled'));
    try {
      await socket.bind(port, bindAddress);
      const bound = socket.address();
      status.message = `Serving ${fileName} over TFTP on ${bound?.address ?? bindAddress}:${bound?.port ?? port}`;
      this.emitWorkflow(status);
      const transfer = new Promise<void>((resolve, reject) => {
        rejectTransfer = reject;
        let client: { address: string; port: number } | null = null;
        let block = 0;
        let finalBlock = false;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          if (error) reject(error);
          else resolve();
        };
        const sendBlock = async (nextBlock: number) => {
          if (!client) return;
          block = nextBlock;
          const offset = (block - 1) * 512;
          const data = bytes.slice(offset, Math.min(bytes.length, offset + 512));
          finalBlock = data.length < 512;
          const packet = new Uint8Array(4 + data.length);
          packet[1] = 3;
          packet[2] = (block >> 8) & 0xff;
          packet[3] = block & 0xff;
          packet.set(data, 4);
          await socket.send(packet, client.port, client.address);
        };
        removeError = socket.onError((error) => finish(error));
        removeMessage = socket.onMessage((message) => {
          const opcode = (message.data[0] ?? 0) * 256 + (message.data[1] ?? 0);
          if (opcode === 1) {
            const requestText = Buffer.from(message.data.slice(2)).toString('utf8');
            const [requestedName, mode] = requestText.split('\0');
            const literalAgentAddress = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(agentHost)
              ? agentHost
              : null;
            if (
              requestedName !== fileName ||
              mode?.toLowerCase() !== 'octet' ||
              (literalAgentAddress && message.address !== literalAgentAddress)
            )
              return;
            client = { address: message.address, port: message.port };
            status.state = 'transferring';
            status.message = `TFTP client ${message.address} requested ${fileName}`;
            status.updatedAt = Date.now();
            this.emitWorkflow(status);
            void sendBlock(1).catch(finish);
            return;
          }
          if (!client || message.address !== client.address || message.port !== client.port) return;
          if (opcode !== 4) return;
          const acknowledged = (message.data[2] ?? 0) * 256 + (message.data[3] ?? 0);
          if (acknowledged !== block) return;
          status.sentBytes = Math.min(bytes.length, block * 512);
          status.updatedAt = Date.now();
          this.emitWorkflow(status);
          if (finalBlock) finish();
          else void sendBlock(block + 1).catch(finish);
        });
        timer = setTimeout(
          () => finish(new Error(`Managed TFTP transfer timed out after ${timeoutMs} ms`)),
          timeoutMs,
        );
        signal.addEventListener('abort', abort, { once: true });
      });
      await trigger();
      await transfer;
    } finally {
      await close();
    }
  }

  private agentKey(agentId: string): string {
    return `live-mibs.agent.${agentId}`;
  }

  private normalizeOverride(
    value: Partial<LiveMibSettings>,
  ): Partial<LiveMibSettings> {
    const normalized = normalizeLiveMibSettings(value);
    return Object.fromEntries(
      Object.keys(value).map((key) => [
        key,
        normalized[key as keyof LiveMibSettings],
      ]),
    ) as Partial<LiveMibSettings>;
  }

  private async createUpload(input: {
    name: string;
    byteLength: number;
    agentId?: string;
  }): Promise<LiveMibUpload> {
    await this.cleanupExpiredUploads();
    const settings = this.settingsForAgent(input.agentId);
    if (!Number.isSafeInteger(input.byteLength) || input.byteLength < 0)
      throw new MibBeaconError('REQ_FAILED', 'Upload size must be a non-negative integer');
    if (input.byteLength > settings.maximumUploadBytes)
      throw new MibBeaconError(
        'REQ_FAILED',
        `Upload exceeds the configured ${settings.maximumUploadBytes}-byte limit`,
      );
    const id = `live-upload-${Date.now()}-${this.sequence++}`;
    const directory = this.files.join(this.files.dataDir(), 'live-mib-uploads');
    await this.files.ensureDir(directory);
    const path = this.files.join(directory, `${id}.bin`);
    await this.files.writeBytes(path, new Uint8Array());
    const upload: InternalUpload = {
      id,
      name: input.name || 'upload.bin',
      byteLength: input.byteLength,
      receivedBytes: 0,
      state: 'receiving',
      path,
      expiresAt: Date.now() + UPLOAD_TTL_MS,
    };
    this.uploads.set(id, upload);
    return this.publicUpload(upload)!;
  }

  private async appendUpload(
    id: string,
    offset: number,
    base64: string,
  ): Promise<LiveMibUpload> {
    await this.cleanupExpiredUploads();
    const upload = this.requireUpload(id);
    if (upload.state !== 'receiving')
      throw new MibBeaconError('REQ_FAILED', 'Upload is already complete');
    if (offset !== upload.receivedBytes)
      throw new MibBeaconError(
        'REQ_FAILED',
        `Upload offset ${offset} does not match expected offset ${upload.receivedBytes}`,
      );
    const chunk = Uint8Array.from(Buffer.from(base64, 'base64'));
    if (upload.receivedBytes + chunk.length > upload.byteLength)
      throw new MibBeaconError('REQ_FAILED', 'Upload chunk exceeds the declared size');
    const current = await this.files.readBytes(upload.path);
    const next = new Uint8Array(current.length + chunk.length);
    next.set(current);
    next.set(chunk, current.length);
    await this.files.writeBytes(upload.path, next);
    upload.receivedBytes += chunk.length;
    upload.expiresAt = Date.now() + UPLOAD_TTL_MS;
    return this.publicUpload(upload)!;
  }

  private async completeUpload(id: string): Promise<LiveMibUpload> {
    await this.cleanupExpiredUploads();
    const upload = this.requireUpload(id);
    if (upload.receivedBytes !== upload.byteLength)
      throw new MibBeaconError(
        'REQ_FAILED',
        `Upload is incomplete: received ${upload.receivedBytes} of ${upload.byteLength} bytes`,
      );
    upload.state = 'ready';
    upload.expiresAt = Date.now() + UPLOAD_TTL_MS;
    return this.publicUpload(upload)!;
  }

  private async disposeUpload(id: string): Promise<void> {
    const upload = this.uploads.get(id);
    this.uploads.delete(id);
    if (upload && (await this.files.exists(upload.path))) await this.files.remove(upload.path);
  }

  private requireUpload(id: string): InternalUpload {
    const upload = this.uploads.get(id);
    if (!upload) throw new MibBeaconError('REQ_FAILED', `Upload ${id} does not exist`);
    return upload;
  }

  private publicUpload(upload?: InternalUpload): LiveMibUpload | null {
    if (!upload) return null;
    const { path: _path, expiresAt: _expiresAt, ...value } = upload;
    return value;
  }

  private settingsForAgent(agentId?: string): LiveMibSettings {
    if (!agentId) return this.settings();
    const overrides =
      getSetting<Partial<LiveMibSettings>>(this.db, this.agentKey(agentId)) ?? {};
    return normalizeLiveMibSettings({ ...this.settings(), ...overrides });
  }

  private async cleanupExpiredUploads(): Promise<void> {
    const expired = [...this.uploads.values()].filter(({ expiresAt }) => expiresAt <= Date.now());
    await Promise.all(expired.map(({ id }) => this.disposeUpload(id)));
  }
}

export function detectLiveMibWorkflows(
  input: LiveMibWorkflowDetection,
): LiveMibWorkflowCandidate[] {
  const syntax = `${input.textualConventionChain?.join(' ') ?? ''} ${input.syntax ?? ''}`;
  const identity = `${input.module ?? ''} ${input.name}`;
  const candidates: LiveMibWorkflowCandidate[] = [];
  if (/OCTET\s+STRING|Opaque/i.test(syntax)) {
    candidates.push({
      id: 'direct-binary',
      name: 'Direct binary value',
      requiresManagedTransfer: false,
      description: 'Send a size-checked file as one OCTET STRING or Opaque value.',
    });
  }
  if (/firmware|image|block|chunk|download|upgrade/i.test(identity)) {
    candidates.push({
      id: 'timed-block-stream',
      name: 'Timed block stream',
      requiresManagedTransfer: false,
      description: 'Send ordered binary blocks using an explicitly configured vendor workflow.',
    });
  }
  if (/CISCO-(?:FLASH|CONFIG-COPY)-MIB|ciscoFlashCopy|ccCopy/i.test(identity)) {
    candidates.push({
      id: 'cisco-transfer-control',
      name: 'Cisco transfer control',
      requiresManagedTransfer: true,
      description: 'Orchestrate protocol, server, file-name, and RowStatus control objects.',
    });
  }
  return candidates;
}
