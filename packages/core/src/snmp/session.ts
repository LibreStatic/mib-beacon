/// <reference path="../../../smi/src/net-snmp.d.ts" />
import snmp from 'net-snmp';
import type { Varbind, Session, V3User } from 'net-snmp';
import { mapSnmpError, MibBeaconError } from '../errors';
import type {
  AgentSpec,
  DecodedVarbind,
  NotificationPayload,
  NotificationSendResult,
  SnmpVarbindInput,
} from './types';
import { encodeVarbindInput } from './varbind-input';

function versionConst(v: AgentSpec['version']): number {
  return v === 'v1' ? snmp.Version1 : v === 'v2c' ? snmp.Version2c : snmp.Version3;
}

function num(
  map: Record<string, number | string>,
  key: string | undefined,
  fallback: number,
): number {
  if (!key) return fallback;
  const v = map[key];
  return typeof v === 'number' ? v : fallback;
}

/**
 * node-net-snmp falls back to process.uptime() when upTime is absent or zero.
 * React Native's process shim has no uptime function, so always provide a
 * positive TimeTicks value. One tick is the closest value the dependency can
 * encode when callers explicitly request zero.
 */
function notificationUptimeTicks(explicit?: number): number {
  if (explicit !== undefined) return Math.max(1, explicit);
  const runtimeMs =
    typeof globalThis.performance?.now === 'function'
      ? globalThis.performance.now()
      : Date.now() % 42_949_672_960;
  return Math.max(1, Math.floor(runtimeMs / 10) % 4_294_967_296);
}

/** Decode a raw net-snmp varbind into a UI-friendly, structured-clone-safe shape. */
export function decodeVarbind(vb: Varbind): DecodedVarbind {
  const typeName = snmp.ObjectType[vb.type] ?? String(vb.type);
  if (snmp.isVarbindError(vb)) {
    return {
      oid: vb.oid,
      type: vb.type,
      typeName,
      value: '',
      isError: true,
      errorText: snmp.varbindError(vb),
    };
  }
  let value: string | number;
  const raw = vb.value;
  if (raw instanceof Uint8Array) {
    if (vb.type === snmp.ObjectType.Counter64) {
      let counter = 0n;
      for (const byte of raw) counter = (counter << 8n) | BigInt(byte);
      value = counter.toString();
      return {
        oid: vb.oid,
        type: vb.type,
        typeName,
        value,
        rawValue: value,
        isError: false,
      };
    }
    // OCTET STRING etc. — expose printable text, fall back to hex.
    const bytes = Array.from(raw);
    const printable = bytes.every((b) => b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127));
    const rawHex = bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ');
    value = printable ? new TextDecoder().decode(raw) : rawHex;
    return {
      oid: vb.oid,
      type: vb.type,
      typeName,
      value,
      rawValue: rawHex,
      rawHex,
      isError: false,
    };
  } else if (typeof raw === 'bigint') {
    value = raw.toString();
  } else if (typeof raw === 'number' || typeof raw === 'string') {
    value = raw;
  } else {
    value = String(raw);
  }
  return { oid: vb.oid, type: vb.type, typeName, value, rawValue: value, isError: false };
}

export class SnmpSession {
  private session: Session;
  private readonly version: AgentSpec['version'];

  constructor(spec: AgentSpec) {
    this.version = spec.version;
    const options = {
      port: spec.port ?? 161,
      // node-net-snmp routes trap() and inform() through trapPort, not port.
      trapPort: spec.port ?? 162,
      version: versionConst(spec.version),
      timeout: spec.timeoutMs ?? 5000,
      retries: spec.retries ?? 1,
      transport: spec.transport ?? 'udp4',
    };
    if (spec.version === 'v3') {
      if (!spec.v3) throw new MibBeaconError('INTERNAL', 'v3 session requires credentials');
      const user: V3User = {
        name: spec.v3.user,
        level: num(snmp.SecurityLevel, spec.v3.level, 1),
        authProtocol: num(snmp.AuthProtocols, spec.v3.authProtocol, 1),
        authKey: spec.v3.authKey,
        privProtocol: num(snmp.PrivProtocols, spec.v3.privProtocol, 1),
        privKey: spec.v3.privKey,
      };
      this.session = snmp.createV3Session(spec.host, user, options);
    } else {
      this.session = snmp.createSession(spec.host, spec.community ?? 'public', options);
    }
  }

  get(oids: string[]): Promise<DecodedVarbind[]> {
    return new Promise((resolve, reject) => {
      this.session.get(oids, (error, varbinds) => {
        if (error) return reject(mapSnmpError(error));
        resolve(varbinds.map(decodeVarbind));
      });
    });
  }

  getNext(oids: string[]): Promise<DecodedVarbind[]> {
    return new Promise((resolve, reject) => {
      this.session.getNext(oids, (error, varbinds) => {
        if (error) return reject(mapSnmpError(error));
        resolve(varbinds.map(decodeVarbind));
      });
    });
  }

  getBulk(oids: string[], nonRepeaters = 0, maxRepetitions = 20): Promise<DecodedVarbind[]> {
    if (this.version === 'v1') {
      return Promise.reject(new MibBeaconError('REQ_FAILED', 'GetBulk requires SNMP v2c or v3'));
    }
    return new Promise((resolve, reject) => {
      const bulkSession = this.session as Session & {
        getBulk(
          requestOids: string[],
          requestNonRepeaters: number,
          requestMaxRepetitions: number,
          callback: (error: Error | null, varbinds: Varbind[]) => void,
        ): void;
      };
      bulkSession.getBulk(oids, nonRepeaters, maxRepetitions, (error, varbinds) => {
        if (error) return reject(mapSnmpError(error));
        resolve(varbinds.map(decodeVarbind));
      });
    });
  }

  set(inputs: SnmpVarbindInput[]): Promise<DecodedVarbind[]> {
    const encoded = inputs.map(encodeVarbindInput);
    return new Promise((resolve, reject) => {
      this.session.set(encoded, (error, varbinds) => {
        if (error) {
          const mapped = mapSnmpError(error);
          const errorIndex = inputs.findIndex((input) => error.message.includes(input.oid));
          if (errorIndex >= 0) {
            return reject(
              new MibBeaconError(mapped.code, mapped.message, {
                hint: mapped.hint,
                cause: error,
                details: {
                  ...mapped.details,
                  errorIndex: errorIndex + 1,
                  oid: inputs[errorIndex]!.oid,
                },
              }),
            );
          }
          return reject(mapped);
        }
        resolve(varbinds.map(decodeVarbind));
      });
    });
  }

  sendNotification(input: NotificationPayload): Promise<NotificationSendResult> {
    if (!/^\d+(?:\.\d+)+$/.test(input.trapOid.trim())) {
      return Promise.reject(
        new MibBeaconError('REQ_FAILED', 'Trap OID must be a valid numeric OID.'),
      );
    }
    if (input.kind === 'inform' && this.version === 'v1') {
      return Promise.reject(new MibBeaconError('REQ_FAILED', 'SNMP informs require v2c or v3.'));
    }
    if (
      input.upTime !== undefined &&
      (!Number.isInteger(input.upTime) || input.upTime < 0 || input.upTime > 4_294_967_295)
    ) {
      return Promise.reject(
        new MibBeaconError('REQ_FAILED', 'Notification uptime must be an unsigned 32-bit integer.'),
      );
    }
    if (this.version === 'v1' && input.agentAddress) {
      const octets = input.agentAddress.split('.');
      if (
        octets.length !== 4 ||
        octets.some((octet) => !/^\d+$/.test(octet) || Number(octet) > 255)
      ) {
        return Promise.reject(
          new MibBeaconError('REQ_FAILED', 'The v1 agent address must be a valid IPv4 address.'),
        );
      }
    }
    const oid = input.trapOid.trim();
    const standardV1 = [
      'ColdStart',
      'WarmStart',
      'LinkDown',
      'LinkUp',
      'AuthenticationFailure',
      'EgpNeighborLoss',
    ];
    const standardMatch = /^1\.3\.6\.1\.6\.3\.1\.1\.5\.([1-6])$/.exec(oid);
    let typeOrOid: string | number = oid;
    if (this.version === 'v1') {
      if (input.v1Generic !== undefined) {
        if (!Number.isInteger(input.v1Generic) || input.v1Generic < 0 || input.v1Generic > 6) {
          return Promise.reject(
            new MibBeaconError('REQ_FAILED', 'SNMPv1 generic trap must be 0 through 6.'),
          );
        }
        if (input.v1Generic === 6) {
          const enterprise = input.v1Enterprise?.trim();
          const specific = input.v1Specific ?? 0;
          if (
            !enterprise ||
            !/^\d+(?:\.\d+)+$/.test(enterprise) ||
            !Number.isInteger(specific) ||
            specific < 0
          ) {
            return Promise.reject(
              new MibBeaconError(
                'REQ_FAILED',
                'Enterprise-specific v1 traps require a numeric enterprise OID and non-negative specific code.',
              ),
            );
          }
          typeOrOid = `${enterprise}.${specific}`;
        } else {
          typeOrOid = input.v1Generic;
        }
      } else if (standardMatch) {
        typeOrOid = snmp.TrapType[standardV1[Number(standardMatch[1]) - 1]!]!;
      } else {
        const enterpriseSpecific = /^(.*)\.0\.(\d+)$/.exec(oid);
        typeOrOid = enterpriseSpecific ? `${enterpriseSpecific[1]}.${enterpriseSpecific[2]}` : oid;
      }
    }
    const varbinds = input.varbinds.map(encodeVarbindInput);
    const options = {
      upTime: notificationUptimeTicks(input.upTime),
      ...(input.agentAddress ? { agentAddr: input.agentAddress } : {}),
    };
    const sentAt = Date.now();
    return new Promise((resolve, reject) => {
      if (input.kind === 'inform') {
        this.session.inform(oid, varbinds, options, (error, response) => {
          if (error) return reject(mapSnmpError(error));
          resolve({
            kind: 'inform',
            sentAt,
            acknowledged: true,
            responseVarbinds: response.map(decodeVarbind),
          });
        });
      } else {
        this.session.trap(typeOrOid, varbinds, options, (error: Error | null) => {
          if (error) return reject(mapSnmpError(error));
          resolve({ kind: 'trap', sentAt, acknowledged: false });
        });
      }
    });
  }

  /**
   * Streaming walk of a subtree. `onBatch` fires per net-snmp feed chunk so the
   * UI can render progressively; resolves with the total count. Uses subtree()
   * so it stops at the subtree boundary rather than walking to end-of-MIB.
   */
  walk(
    baseOid: string,
    onBatch: (batch: DecodedVarbind[]) => void,
    opts: { maxRepetitions?: number; maxVarbinds?: number } = {},
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      let total = 0;
      let previousOid: string | null = null;
      let guardError: MibBeaconError | null = null;
      const maxVarbinds = opts.maxVarbinds ?? 100_000;
      const feed = (varbinds: Varbind[]) => {
        if (guardError) return;
        const decoded = varbinds.map(decodeVarbind);
        for (const varbind of decoded) {
          if (previousOid && compareOids(varbind.oid, previousOid) <= 0) {
            guardError = new MibBeaconError(
              'REQ_OID_NOT_INCREASING',
              `Agent returned non-increasing OID ${varbind.oid} after ${previousOid}`,
              { hint: 'The agent is misbehaving; reduce GetBulk sizing or use GetNext.' },
            );
            return;
          }
          previousOid = varbind.oid;
        }
        if (total + decoded.length > maxVarbinds) {
          guardError = new MibBeaconError(
            'REQ_TOO_BIG',
            `Walk hard cap of ${maxVarbinds} varbinds was reached`,
            { hint: 'Narrow the subtree or explicitly raise the walk cap.' },
          );
          return;
        }
        total += decoded.length;
        onBatch(decoded);
      };
      this.session.subtree(baseOid, opts.maxRepetitions ?? 20, feed, (error) => {
        if (guardError) return reject(guardError);
        if (error) return reject(mapSnmpError(error));
        resolve(total);
      });
    });
  }

  close(): void {
    try {
      this.session.close();
    } catch {
      /* already closed */
    }
  }
}

function compareOids(left: string, right: string): number {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if (a[index] === undefined) return -1;
    if (b[index] === undefined) return 1;
    if (a[index]! !== b[index]!) return a[index]! - b[index]!;
  }
  return 0;
}
