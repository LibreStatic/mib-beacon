import snmp from 'net-snmp';
import type { Varbind, Session, V3User } from 'net-snmp';
import { mapSnmpError, OmcError } from '../errors.js';
import type { AgentSpec, DecodedVarbind } from './types.js';

function versionConst(v: AgentSpec['version']): number {
  return v === 'v1' ? snmp.Version1 : v === 'v2c' ? snmp.Version2c : snmp.Version3;
}

function num(map: Record<string, number | string>, key: string | undefined, fallback: number): number {
  if (!key) return fallback;
  const v = map[key];
  return typeof v === 'number' ? v : fallback;
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
    // OCTET STRING etc. — expose printable text, fall back to hex.
    const bytes = Array.from(raw);
    const printable = bytes.every((b) => b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127));
    value = printable
      ? new TextDecoder().decode(raw)
      : bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ');
  } else if (typeof raw === 'bigint') {
    value = raw.toString();
  } else if (typeof raw === 'number' || typeof raw === 'string') {
    value = raw;
  } else {
    value = String(raw);
  }
  return { oid: vb.oid, type: vb.type, typeName, value, isError: false };
}

export class SnmpSession {
  private session: Session;

  constructor(spec: AgentSpec) {
    const options = {
      port: spec.port ?? 161,
      version: versionConst(spec.version),
      timeout: spec.timeoutMs ?? 5000,
      retries: spec.retries ?? 1,
      transport: spec.transport ?? 'udp4',
    };
    if (spec.version === 'v3') {
      if (!spec.v3) throw new OmcError('INTERNAL', 'v3 session requires credentials');
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

  /**
   * Streaming walk of a subtree. `onBatch` fires per net-snmp feed chunk so the
   * UI can render progressively; resolves with the total count. Uses subtree()
   * so it stops at the subtree boundary rather than walking to end-of-MIB.
   */
  walk(
    baseOid: string,
    onBatch: (batch: DecodedVarbind[]) => void,
    opts: { maxRepetitions?: number } = {},
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      let total = 0;
      const feed = (varbinds: Varbind[]) => {
        const decoded = varbinds.map(decodeVarbind);
        total += decoded.length;
        onBatch(decoded);
      };
      this.session.subtree(baseOid, opts.maxRepetitions ?? 20, feed, (error) => {
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
