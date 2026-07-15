/// <reference path="../../../smi/src/net-snmp.d.ts" />
import snmp from 'net-snmp';
import type { Pdu, Receiver, Notification } from 'net-snmp';
import { mapSnmpError } from '../errors';
import { decodeVarbind } from './session';
import type { DecodedVarbind } from './types';
import { bytesToPacketHex, type PacketTraceEvent } from '../packet-trace';

export interface TrapRecord {
  id: string;
  receivedAt: number;
  sourceAddress: string;
  sourcePort: number;
  version: number;
  community?: string;
  securityName?: string;
  pduType: number;
  varbinds: DecodedVarbind[];
  /** best-effort snmpTrapOID (v2c) — first varbind value after sysUpTime, if present */
  trapOid?: string;
  /** MIB-resolved name of trapOid (decorated by the engine). */
  trapName?: string;
  trapDescription?: string;
  sysUpTime?: number;
  expectedObjects?: string[];
  missingObjects?: string[];
  extraObjects?: string[];
  rawPduHex?: string;
  parseError?: string;
  readAt?: number;
  severity?: 'info' | 'warning' | 'critical';
  color?: string;
  matchedRuleIds?: string[];
}

export interface TrapV3User {
  name: string;
  level: number;
  authProtocol?: number;
  authKey?: string;
  privProtocol?: number;
  privKey?: string;
}

export interface TrapReceiverConfig {
  port?: number; // default 1162 (privileged 162 needs elevation)
  transport?: 'udp4' | 'udp6' | 'dual';
  /** lab convenience: accept unauthenticated/unknown senders */
  disableAuthorization?: boolean;
  communities?: string[];
  v3Users?: TrapV3User[];
  ringCap?: number;
}

const SNMP_TRAP_OID = '1.3.6.1.6.3.1.1.4.1.0';

export function trapOidFromPdu(pdu: Pdu): string | undefined {
  if (typeof pdu.generic === 'number') {
    if (pdu.generic >= 0 && pdu.generic <= 5) {
      return `1.3.6.1.6.3.1.1.5.${pdu.generic + 1}`;
    }
    if (pdu.generic === 6 && pdu.enterprise && pdu.specific !== undefined) {
      return `${pdu.enterprise}.0.${pdu.specific}`;
    }
  }
  const raw = pdu.varbinds?.find((varbind) => varbind.oid === SNMP_TRAP_OID)?.value;
  return raw === undefined ? undefined : String(raw);
}

/**
 * Thin wrapper over node-net-snmp's Receiver. Decodes each notification into a
 * structured-clone-safe TrapRecord and never crashes on a malformed packet.
 */
export class TrapReceiver {
  private receiver: Receiver | null = null;
  private seq = 0;
  private drops = 0;
  private readonly rawBySource = new Map<string, RawCapture>();

  constructor(
    private readonly onTrap: (rec: TrapRecord) => void,
    private readonly onError?: (err: Error) => void,
    private readonly onPacket?: (event: PacketTraceEvent) => void,
  ) {}

  async start(cfg: TrapReceiverConfig): Promise<{ port: number; transports: ('udp4' | 'udp6')[] }> {
    const port = cfg.port ?? 1162;
    try {
      const requested = cfg.transport ?? 'dual';
      let transports: ('udp4' | 'udp6')[] =
        requested === 'dual' ? ['udp4', 'udp6'] : [requested];
      let receiver: Receiver | null = null;
      try {
        receiver = this.createReceiver(cfg, port, transports);
        await waitUntilListening(receiver);
      } catch (error) {
        if (requested !== 'dual') throw error;
        if (receiver) await this.closeReceiver(receiver);
        transports = ['udp4'];
        receiver = this.createReceiver(cfg, port, transports);
        await waitUntilListening(receiver);
      }
      if (!receiver) throw new Error('SNMP receiver failed to initialize');
      this.receiver = receiver;
      const authorizer = receiver.getAuthorizer();
      for (const c of cfg.communities ?? ['public']) authorizer.addCommunity(c);
      for (const u of cfg.v3Users ?? []) authorizer.addUser(u);
      this.attachRawCapture(receiver);
      return { port, transports };
    } catch (e) {
      await this.closeCurrentReceiver();
      throw mapSnmpError(e);
    }
  }

  get dropCount(): number {
    return this.drops;
  }

  private createReceiver(
    cfg: TrapReceiverConfig,
    port: number,
    transports: ('udp4' | 'udp6')[],
  ): Receiver {
    return snmp.createReceiver(
      {
        port,
        transport: transports[0],
        ...(transports.length > 1
          ? {
              sockets: transports.map((transport) => ({
                transport,
                address: transport === 'udp4' ? '0.0.0.0' : '::',
                port,
              })),
            }
          : {}),
        disableAuthorization: cfg.disableAuthorization ?? false,
        includeAuthentication: true,
      },
      (error, notification) => {
        if (error) {
          this.drops += 1;
          queueMicrotask(() => {
            const processing = error as Error & { rinfo?: { address?: string; port?: number } };
            if (processing.rinfo?.address && processing.rinfo.port !== undefined) {
              const key = sourceKey({ address: processing.rinfo.address, port: processing.rinfo.port });
              const capture = this.rawBySource.get(key);
              this.rawBySource.delete(key);
              if (capture) this.finishPacket(capture, 'invalid', 'unknown', processing.message);
            }
            const malformed = this.decodeMalformed(error);
            if (malformed) this.onTrap(malformed);
            this.onError?.(mapSnmpError(error));
          });
          return;
        }
        queueMicrotask(() => {
          try {
            const raw = this.rawBySource.get(sourceKey(notification.rinfo));
            this.rawBySource.delete(sourceKey(notification.rinfo));
            if (raw) {
              this.finishPacket(
                raw,
                'valid',
                notification.pdu.type === snmp.PduType.InformRequest ? 'inform' : 'trap',
              );
            }
            this.onTrap(this.decode(notification, raw));
          } catch (decodeError) {
            this.drops += 1;
            this.onError?.(mapSnmpError(decodeError));
          }
        });
      },
    );
  }

  private decode(n: Notification, raw?: RawCapture): TrapRecord {
    const varbinds = (n.pdu.varbinds ?? []).map(decodeVarbind);
    const trapOid = trapOidFromPdu(n.pdu);
    const version = n.pdu.user
      ? snmp.Version3
      : n.pdu.type === snmp.PduType.Trap
        ? snmp.Version1
        : snmp.Version2c;
    const securityName = n.pdu.user ?? n.pdu.community;
    const upTimeRaw = n.pdu.upTime ?? n.pdu.varbinds?.find((varbind) => varbind.oid === '1.3.6.1.2.1.1.3.0')?.value;
    return {
      id: `trap-${Date.now()}-${this.seq++}`,
      receivedAt: Date.now(),
      sourceAddress: n.rinfo.address,
      sourcePort: n.rinfo.port,
      version,
      community: n.pdu.community,
      ...(securityName ? { securityName } : {}),
      pduType: n.pdu.type,
      varbinds,
      trapOid,
      ...(typeof upTimeRaw === 'number' ? { sysUpTime: upTimeRaw } : {}),
      ...(raw ? { rawPduHex: bytesToPacketHex(raw.data) } : {}),
    };
  }

  private decodeMalformed(error: Error): TrapRecord | null {
    const processing = error as Error & {
      rinfo?: { address?: string; port?: number };
      buffer?: Uint8Array;
      error?: Error;
    };
    if (!processing.buffer) return null;
    return {
      id: `trap-${Date.now()}-${this.seq++}`,
      receivedAt: Date.now(),
      sourceAddress: processing.rinfo?.address ?? 'unknown',
      sourcePort: processing.rinfo?.port ?? 0,
      version: -1,
      pduType: -1,
      varbinds: [],
      rawPduHex: bytesToPacketHex(processing.buffer),
      parseError: processing.error?.message ?? processing.message,
    };
  }

  private attachRawCapture(receiver: Receiver): void {
    for (const socket of receiverSockets(receiver)) {
      this.attachRawSendCapture(socket);
      socket.on?.('message', (data, rinfo) => {
        const key = sourceKey(rinfo);
        const address = receiverSocketAddress(socket);
        const capture: RawCapture = {
          data: new Uint8Array(data),
          event: {
            id: `packet-${Date.now()}-${this.seq++}`,
            timestamp: Date.now(),
            direction: 'rx',
            status: 'pending',
            transport: rinfo.address.includes(':') ? 'udp6' : 'udp4',
            operation: 'unknown',
            ...(address ? { localAddress: address.address, localPort: address.port } : {}),
            remoteAddress: rinfo.address,
            remotePort: rinfo.port,
            byteLength: data.length,
            rawHex: bytesToPacketHex(data),
          },
        };
        this.rawBySource.set(key, capture);
        this.onPacket?.(capture.event);
        setTimeout(() => {
          if (this.rawBySource.get(key) !== capture) return;
          this.rawBySource.delete(key);
          this.drops += 1;
          this.finishPacket(capture, 'invalid', 'unknown', 'Undecodable or unauthorized SNMP notification');
          this.onTrap({
            id: `trap-${Date.now()}-${this.seq++}`,
            receivedAt: Date.now(),
            sourceAddress: rinfo.address,
            sourcePort: rinfo.port,
            version: -1,
            pduType: -1,
            varbinds: [],
            rawPduHex: bytesToPacketHex(data),
            parseError: 'Undecodable or unauthorized SNMP notification',
          });
        }, 50);
      });
    }
  }

  private attachRawSendCapture(socket: ReceiverSocket): void {
    if (!this.onPacket || !socket.send) return;
    const originalSend = socket.send.bind(socket);
    socket.send = (...args: unknown[]) => {
      const librarySignature =
        args.length >= 6 &&
        typeof args[1] === 'number' &&
        typeof args[2] === 'number' &&
        typeof args[3] === 'number' &&
        typeof args[4] === 'string';
      if (!librarySignature) return originalSend(...args);
      const source = args[0] as Uint8Array;
      const offset = args[1] as number;
      const length = args[2] as number;
      const remotePort = args[3] as number;
      const remoteAddress = args[4] as string;
      const callback = args[5] as ((error?: Error | null, bytes?: number) => void) | undefined;
      const raw = new Uint8Array(source).slice(offset, offset + length);
      const local = receiverSocketAddress(socket);
      const event: PacketTraceEvent = {
        id: `packet-${Date.now()}-${this.seq++}`,
        timestamp: Date.now(),
        direction: 'tx',
        status: 'pending',
        transport: remoteAddress.includes(':') ? 'udp6' : 'udp4',
        operation: 'response',
        ...(local ? { localAddress: local.address, localPort: local.port } : {}),
        remoteAddress,
        remotePort,
        byteLength: raw.length,
        rawHex: bytesToPacketHex(raw),
      };
      this.onPacket?.(event);
      args[5] = (error?: Error | null, bytes?: number) => {
        this.onPacket?.({
          ...event,
          status: error ? 'invalid' : 'valid',
          ...(error ? { error: error.message } : {}),
        });
        callback?.(error, bytes);
      };
      return originalSend(...args);
    };
  }

  private finishPacket(
    capture: RawCapture,
    status: 'valid' | 'invalid',
    operation: PacketTraceEvent['operation'],
    error?: string,
  ): void {
    this.onPacket?.({
      ...capture.event,
      status,
      operation,
      ...(error ? { error } : {}),
    });
  }

  async stop(): Promise<void> {
    await this.closeCurrentReceiver();
  }

  private async closeCurrentReceiver(): Promise<void> {
    const receiver = this.receiver;
    this.receiver = null;
    if (!receiver) return;
    await this.closeReceiver(receiver);
  }

  private async closeReceiver(receiver: Receiver): Promise<void> {
    const sockets = receiverSockets(receiver);
    if (sockets.length === 0) {
      await new Promise<void>((resolve) => {
        try {
          receiver.close(() => resolve());
        } catch {
          resolve();
        }
      });
      return;
    }
    await Promise.all(
      sockets.map(
        (socket) =>
          new Promise<void>((resolve) => {
            try {
              socket.close(() => resolve());
            } catch {
              resolve();
            }
          }),
      ),
    );
  }
}

interface ReceiverSocket {
  once(event: 'listening', listener: () => void): this;
  once(event: 'error', listener: (error: Error) => void): this;
  off(event: 'listening', listener: () => void): this;
  off(event: 'error', listener: (error: Error) => void): this;
  on?(event: 'message', listener: (data: Uint8Array, rinfo: { address: string; port: number }) => void): this;
  send?(...args: unknown[]): unknown;
  address(): unknown;
  close(callback?: () => void): this;
}

function sourceKey(rinfo: { address: string; port: number }): string {
  return `${rinfo.address}:${rinfo.port}`;
}

interface RawCapture { data: Uint8Array; event: PacketTraceEvent }

interface ReceiverWithSockets extends Receiver {
  listener?: { sockets?: Record<string, ReceiverSocket> };
}

function receiverSocketAddress(socket: ReceiverSocket): { address: string; port: number } | null {
  try {
    const value = socket.address() as { address?: string; port?: number };
    return typeof value.address === 'string' && typeof value.port === 'number'
      ? { address: value.address, port: value.port }
      : null;
  } catch {
    return null;
  }
}

function receiverSockets(receiver: Receiver): ReceiverSocket[] {
  return Object.values((receiver as ReceiverWithSockets).listener?.sockets ?? {});
}

/**
 * node-net-snmp starts binding asynchronously but exposes no readiness promise.
 * Its listener sockets are the only authoritative signal that startup succeeded.
 */
async function waitUntilListening(receiver: Receiver): Promise<void> {
  const sockets = receiverSockets(receiver);
  if (sockets.length === 0) throw new Error('SNMP receiver did not create a UDP socket');
  await Promise.all(
    sockets.map(
      (socket) =>
        new Promise<void>((resolve, reject) => {
          const cleanup = () => {
            socket.off('listening', onListening);
            socket.off('error', onError);
          };
          const onListening = () => {
            cleanup();
            resolve();
          };
          const onError = (error: Error) => {
            cleanup();
            reject(error);
          };
          try {
            socket.address();
            resolve();
            return;
          } catch {
            // Binding is still in progress; wait for its terminal event.
          }
          socket.once('listening', onListening);
          socket.once('error', onError);
        }),
    ),
  );
}
