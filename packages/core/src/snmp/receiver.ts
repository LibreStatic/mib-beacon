/// <reference path="../net-snmp.d.ts" />
import snmp from 'net-snmp';
import type { Receiver, Notification } from 'net-snmp';
import { mapSnmpError } from '../errors.js';
import { decodeVarbind } from './session.js';
import type { DecodedVarbind } from './types.js';

export interface TrapRecord {
  id: string;
  receivedAt: number;
  sourceAddress: string;
  sourcePort: number;
  version: number;
  community?: string;
  pduType: number;
  varbinds: DecodedVarbind[];
  /** best-effort snmpTrapOID (v2c) — first varbind value after sysUpTime, if present */
  trapOid?: string;
  parseError?: string;
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
  transport?: 'udp4' | 'udp6';
  /** lab convenience: accept unauthenticated/unknown senders */
  disableAuthorization?: boolean;
  communities?: string[];
  v3Users?: TrapV3User[];
}

const SNMP_TRAP_OID = '1.3.6.1.6.3.1.1.4.1.0';

/**
 * Thin wrapper over node-net-snmp's Receiver. Decodes each notification into a
 * structured-clone-safe TrapRecord and never crashes on a malformed packet.
 */
export class TrapReceiver {
  private receiver: Receiver | null = null;
  private seq = 0;

  constructor(
    private readonly onTrap: (rec: TrapRecord) => void,
    private readonly onError?: (err: Error) => void,
  ) {}

  start(cfg: TrapReceiverConfig): { port: number } {
    const port = cfg.port ?? 1162;
    const options = {
      port,
      transport: cfg.transport ?? ('udp4' as const),
      disableAuthorization: cfg.disableAuthorization ?? false,
      includeAuthentication: true,
    };
    try {
      this.receiver = snmp.createReceiver(options, (error, notification) => {
        if (error) {
          this.onError?.(mapSnmpError(error));
          return;
        }
        try {
          this.onTrap(this.decode(notification));
        } catch (e) {
          this.onError?.(mapSnmpError(e));
        }
      });
      const authorizer = this.receiver.getAuthorizer();
      for (const c of cfg.communities ?? ['public']) authorizer.addCommunity(c);
      for (const u of cfg.v3Users ?? []) authorizer.addUser(u);
      return { port };
    } catch (e) {
      throw mapSnmpError(e);
    }
  }

  private decode(n: Notification): TrapRecord {
    const varbinds = (n.pdu.varbinds ?? []).map(decodeVarbind);
    const trapOidVb = varbinds.find((v) => v.oid === SNMP_TRAP_OID);
    return {
      id: `trap-${Date.now()}-${this.seq++}`,
      receivedAt: Date.now(),
      sourceAddress: n.rinfo.address,
      sourcePort: n.rinfo.port,
      version: n.pdu.type,
      community: n.pdu.community,
      pduType: n.pdu.type,
      varbinds,
      trapOid: trapOidVb ? String(trapOidVb.value) : undefined,
    };
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.receiver) return resolve();
      this.receiver.close(() => resolve());
      this.receiver = null;
    });
  }
}
