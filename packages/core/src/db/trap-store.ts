import type { SqlValue, StorageAdapter, Transport } from '@mibbeacon/transport';
import { MibBeaconError } from '../errors';
import type {
  TrapQuery,
  TrapRule,
  TrapRuleDraft,
  TrapSavedFilter,
  TrapSendPreset,
  TrapV3UserDraft,
  TrapV3UserProfile,
} from '../api/engine-api';
import type { NotificationPayload } from '../snmp/types';
import type { TrapRecord, TrapV3User } from '../snmp/receiver';
import snmp from 'net-snmp';

interface TrapRow {
  id: string;
  received_at: number;
  source_address: string;
  source_port: number;
  version: number;
  security_name: string | null;
  pdu_type: number;
  trap_oid: string | null;
  trap_name: string | null;
  trap_description: string | null;
  expected_objects_json: string;
  missing_objects_json: string;
  extra_objects_json: string;
  varbinds_json: string;
  raw_pdu_hex: string | null;
  parse_error: string | null;
  read_at: number | null;
  severity: TrapRecord['severity'] | null;
  color: string | null;
  matched_rule_ids_json: string;
}

interface V3UserRow {
  name: string;
  security_json: string;
  auth_ref: string | null;
  priv_ref: string | null;
  created_at: number;
  updated_at: number;
}

interface ArtifactRow {
  id: string;
  name: string;
  query_json?: string;
  agent_id?: string;
  payload_json?: string;
  created_at: number;
  updated_at: number;
}

interface RuleRow {
  id: string;
  name: string;
  enabled: number;
  priority: number;
  condition_json: string;
  actions_json: string;
  created_at: number;
  updated_at: number;
}

export class TrapStore {
  constructor(
    private readonly db: StorageAdapter,
    private readonly transport: Transport,
    private readonly now: () => number = Date.now,
  ) {}

  insert(record: TrapRecord, cap = 50_000): TrapRecord {
    const boundedCap = Math.max(100, Math.min(500_000, Math.trunc(cap)));
    this.db.transaction(() => {
      this.db.run(
        `INSERT OR REPLACE INTO traps
         (id, received_at, source_address, source_port, version, security_name, pdu_type,
          trap_oid, trap_name, trap_description, expected_objects_json, missing_objects_json,
          extra_objects_json, varbinds_json, raw_pdu_hex, parse_error, read_at, severity,
          color, matched_rule_ids_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.id,
          record.receivedAt,
          record.sourceAddress,
          record.sourcePort,
          record.version,
          record.securityName ?? record.community ?? null,
          record.pduType,
          record.trapOid ?? null,
          record.trapName ?? null,
          record.trapDescription ?? null,
          JSON.stringify(record.expectedObjects ?? []),
          JSON.stringify(record.missingObjects ?? []),
          JSON.stringify(record.extraObjects ?? []),
          JSON.stringify(record.varbinds),
          record.rawPduHex ?? null,
          record.parseError ?? null,
          record.readAt ?? null,
          record.severity ?? null,
          record.color ?? null,
          JSON.stringify(record.matchedRuleIds ?? []),
        ],
      );
      this.db.run(
        `DELETE FROM traps WHERE id IN
         (SELECT id FROM traps ORDER BY received_at DESC, id DESC LIMIT -1 OFFSET ?)`,
        [boundedCap],
      );
    });
    return record;
  }

  list(limit = 500): TrapRecord[] {
    return this.query({ limit });
  }

  query(query: TrapQuery): TrapRecord[] {
    const where: string[] = [];
    const params: SqlValue[] = [];
    if (query.from !== undefined) {
      where.push('received_at >= ?');
      params.push(query.from);
    }
    if (query.to !== undefined) {
      where.push('received_at <= ?');
      params.push(query.to);
    }
    if (query.source?.trim()) {
      where.push('source_address LIKE ?');
      params.push(`${escapeLike(query.source.trim())}%`);
    }
    if (query.trap?.trim()) {
      where.push("(trap_oid LIKE ? ESCAPE '\\' OR trap_name LIKE ? ESCAPE '\\')");
      const term = `%${escapeLike(query.trap.trim())}%`;
      params.push(term, term);
    }
    if (query.version !== undefined) {
      where.push('version = ?');
      params.push(query.version);
    }
    if (query.text?.trim()) {
      where.push("varbinds_json LIKE ? ESCAPE '\\'");
      params.push(`%${escapeLike(query.text.trim())}%`);
    }
    if (query.unread !== undefined)
      where.push(query.unread ? 'read_at IS NULL' : 'read_at IS NOT NULL');
    const limit = Math.max(1, Math.min(50_000, Math.trunc(query.limit ?? 500)));
    const offset = Math.max(0, Math.trunc(query.offset ?? 0));
    params.push(limit, offset);
    return this.db
      .all<TrapRow>(
        `SELECT * FROM traps${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
         ORDER BY received_at DESC, id DESC LIMIT ? OFFSET ?`,
        params,
      )
      .map(trapFromRow);
  }

  markRead(ids: string[], read = true): void {
    const unique = [...new Set(ids)].filter(Boolean);
    if (unique.length === 0) return;
    const placeholders = unique.map(() => '?').join(',');
    this.db.run(`UPDATE traps SET read_at = ? WHERE id IN (${placeholders})`, [
      read ? this.now() : null,
      ...unique,
    ]);
  }

  delete(ids: string[]): void {
    const unique = [...new Set(ids)].filter(Boolean);
    if (unique.length === 0) return;
    const placeholders = unique.map(() => '?').join(',');
    this.db.run(`DELETE FROM traps WHERE id IN (${placeholders})`, unique);
  }

  unreadCount(): number {
    return (
      this.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM traps WHERE read_at IS NULL')
        ?.count ?? 0
    );
  }

  count(): number {
    return this.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM traps')?.count ?? 0;
  }

  clear(): void {
    this.db.run('DELETE FROM traps');
  }

  listFilters(): TrapSavedFilter[] {
    return this.db
      .all<ArtifactRow>('SELECT * FROM trap_saved_filters ORDER BY name COLLATE NOCASE')
      .map((row) => ({
        id: row.id,
        name: row.name,
        query: JSON.parse(row.query_json!) as TrapQuery,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
  }

  saveFilter(nameInput: string, query: TrapQuery): TrapSavedFilter {
    const name = requiredName(nameInput, 'Filter');
    const existing = this.db.get<ArtifactRow>('SELECT * FROM trap_saved_filters WHERE name = ?', [
      name,
    ]);
    const timestamp = this.now();
    const id = existing?.id ?? this.id('trap-filter');
    this.db.run(
      `INSERT INTO trap_saved_filters (id, name, query_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET query_json = excluded.query_json, updated_at = excluded.updated_at`,
      [id, name, JSON.stringify(query), existing?.created_at ?? timestamp, timestamp],
    );
    return this.listFilters().find((item) => item.id === id)!;
  }

  removeFilter(id: string): void {
    this.db.run('DELETE FROM trap_saved_filters WHERE id = ?', [id]);
  }

  listPresets(): TrapSendPreset[] {
    return this.db
      .all<ArtifactRow>('SELECT * FROM trap_send_presets ORDER BY name COLLATE NOCASE')
      .map((row) => ({
        id: row.id,
        name: row.name,
        agentId: row.agent_id!,
        payload: JSON.parse(row.payload_json!) as NotificationPayload,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
  }

  savePreset(nameInput: string, agentId: string, payload: NotificationPayload): TrapSendPreset {
    const name = requiredName(nameInput, 'Preset');
    if (!agentId) throw new Error('A saved agent is required for trap presets');
    const existing = this.db.get<ArtifactRow>('SELECT * FROM trap_send_presets WHERE name = ?', [
      name,
    ]);
    const timestamp = this.now();
    const id = existing?.id ?? this.id('trap-preset');
    this.db.run(
      `INSERT INTO trap_send_presets (id, name, agent_id, payload_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET agent_id = excluded.agent_id,
         payload_json = excluded.payload_json, updated_at = excluded.updated_at`,
      [id, name, agentId, JSON.stringify(payload), existing?.created_at ?? timestamp, timestamp],
    );
    return this.listPresets().find((item) => item.id === id)!;
  }

  removePreset(id: string): void {
    this.db.run('DELETE FROM trap_send_presets WHERE id = ?', [id]);
  }

  listRules(): TrapRule[] {
    return this.db
      .all<RuleRow>('SELECT * FROM trap_rules ORDER BY priority, name COLLATE NOCASE')
      .map(ruleFromRow);
  }

  createRule(draft: TrapRuleDraft): TrapRule {
    const id = this.id('trap-rule');
    const timestamp = this.now();
    this.writeRule(id, draft, timestamp, timestamp);
    return this.requireRule(id);
  }

  updateRule(id: string, patch: Partial<TrapRuleDraft>): TrapRule {
    const current = this.requireRule(id);
    this.writeRule(
      id,
      {
        name: patch.name ?? current.name,
        enabled: patch.enabled ?? current.enabled,
        priority: patch.priority ?? current.priority,
        condition: patch.condition ?? current.condition,
        actions: patch.actions ?? current.actions,
      },
      current.createdAt,
      this.now(),
    );
    return this.requireRule(id);
  }

  removeRule(id: string): void {
    this.db.run('DELETE FROM trap_rules WHERE id = ?', [id]);
  }

  listV3Users(): TrapV3UserProfile[] {
    return this.db
      .all<V3UserRow>('SELECT * FROM trap_v3_users ORDER BY name COLLATE NOCASE')
      .map(publicV3User);
  }

  async upsertV3User(draft: TrapV3UserDraft): Promise<TrapV3UserProfile> {
    const name = requiredName(draft.name, 'SNMPv3 user');
    const current = this.db.get<V3UserRow>('SELECT * FROM trap_v3_users WHERE name = ?', [name]);
    const refs = { auth: `trap-users/${name}/auth-key`, priv: `trap-users/${name}/priv-key` };
    if ((draft.authKey || draft.privKey) && !this.transport.secrets.isEncrypted()) {
      throw new MibBeaconError(
        'SECRET_STORAGE_UNAVAILABLE',
        'Encrypted credential storage is unavailable for the trap receiver user',
      );
    }
    let authRef = draft.clearAuthKey ? null : (current?.auth_ref ?? null);
    let privRef = draft.clearPrivKey ? null : (current?.priv_ref ?? null);
    if (draft.authKey !== undefined) {
      if (draft.authKey) {
        authRef = refs.auth;
      } else authRef = null;
    }
    if (draft.privKey !== undefined) {
      if (draft.privKey) {
        privRef = refs.priv;
      } else privRef = null;
    }
    // Validate the complete prospective profile before touching write-only
    // credentials. A rejected metadata change must never partially replace or
    // delete the last-confirmed secrets.
    validateV3User(draft, authRef, privRef);
    const touched = new Map<string, string | null>();
    const remember = async (reference: string) => {
      if (!touched.has(reference))
        touched.set(reference, await this.transport.secrets.get(reference));
    };
    const remove = async (reference: string) => {
      await remember(reference);
      await this.transport.secrets.delete(reference);
    };
    const replace = async (reference: string, value: string) => {
      await remember(reference);
      await this.transport.secrets.set(reference, value);
    };
    try {
      if (draft.clearAuthKey && current?.auth_ref) await remove(current.auth_ref);
      if (draft.clearPrivKey && current?.priv_ref) await remove(current.priv_ref);
      if (draft.authKey !== undefined) {
        if (draft.authKey) await replace(refs.auth, draft.authKey);
        else if (current?.auth_ref) await remove(current.auth_ref);
      }
      if (draft.privKey !== undefined) {
        if (draft.privKey) await replace(refs.priv, draft.privKey);
        else if (current?.priv_ref) await remove(current.priv_ref);
      }
      const timestamp = this.now();
      this.db.run(
        `INSERT INTO trap_v3_users
         (name, security_json, auth_ref, priv_ref, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET security_json = excluded.security_json,
           auth_ref = excluded.auth_ref, priv_ref = excluded.priv_ref, updated_at = excluded.updated_at`,
        [
          name,
          JSON.stringify({
            level: draft.level,
            ...(draft.authProtocol === undefined ? {} : { authProtocol: draft.authProtocol }),
            ...(draft.privProtocol === undefined ? {} : { privProtocol: draft.privProtocol }),
          }),
          authRef,
          privRef,
          current?.created_at ?? timestamp,
          timestamp,
        ],
      );
    } catch (cause) {
      // Best-effort rollback covers partial secret-store writes and DB failures.
      const rollback = await Promise.allSettled(
        [...touched].map(([reference, previous]) =>
          previous === null
            ? this.transport.secrets.delete(reference)
            : this.transport.secrets.set(reference, previous),
        ),
      );
      if (rollback.some((result) => result.status === 'rejected')) {
        throw new MibBeaconError(
          'INTERNAL',
          'Secret rollback outcome unknown after trap-user update failure',
          { cause },
        );
      }
      throw cause;
    }
    return this.listV3Users().find((user) => user.name === name)!;
  }

  async removeV3User(name: string): Promise<void> {
    const row = this.db.get<V3UserRow>('SELECT * FROM trap_v3_users WHERE name = ?', [name]);
    if (!row) return;
    const references = [row.auth_ref, row.priv_ref].filter(
      (reference): reference is string => !!reference,
    );
    const previous = new Map<string, string | null>();
    try {
      for (const reference of references) {
        previous.set(reference, await this.transport.secrets.get(reference));
        await this.transport.secrets.delete(reference);
      }
      this.db.run('DELETE FROM trap_v3_users WHERE name = ?', [name]);
    } catch (cause) {
      const rollback = await Promise.allSettled(
        [...previous].map(([reference, value]) =>
          value === null
            ? this.transport.secrets.delete(reference)
            : this.transport.secrets.set(reference, value),
        ),
      );
      if (rollback.some((result) => result.status === 'rejected')) {
        throw new MibBeaconError(
          'INTERNAL',
          'Secret rollback outcome unknown after trap-user removal failure',
          { cause },
        );
      }
      throw cause;
    }
  }

  async resolveV3Users(): Promise<TrapV3User[]> {
    return Promise.all(
      this.db.all<V3UserRow>('SELECT * FROM trap_v3_users ORDER BY name').map(async (row) => {
        const security = JSON.parse(row.security_json) as Pick<
          TrapV3UserProfile,
          'level' | 'authProtocol' | 'privProtocol'
        >;
        const authKey = row.auth_ref ? await this.transport.secrets.get(row.auth_ref) : null;
        const privKey = row.priv_ref ? await this.transport.secrets.get(row.priv_ref) : null;
        return {
          name: row.name,
          level: snmp.SecurityLevel[security.level] as number,
          ...(security.authProtocol
            ? { authProtocol: snmp.AuthProtocols[security.authProtocol] as number }
            : {}),
          ...(security.privProtocol
            ? { privProtocol: snmp.PrivProtocols[security.privProtocol] as number }
            : {}),
          ...(authKey ? { authKey } : {}),
          ...(privKey ? { privKey } : {}),
        };
      }),
    );
  }

  private writeRule(id: string, draft: TrapRuleDraft, createdAt: number, updatedAt: number): void {
    const name = requiredName(draft.name, 'Rule');
    if (!Number.isFinite(draft.priority)) throw new Error('Rule priority must be a number');
    this.db.run(
      `INSERT INTO trap_rules
       (id, name, enabled, priority, condition_json, actions_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, enabled = excluded.enabled,
         priority = excluded.priority, condition_json = excluded.condition_json,
         actions_json = excluded.actions_json, updated_at = excluded.updated_at`,
      [
        id,
        name,
        draft.enabled ? 1 : 0,
        Math.trunc(draft.priority),
        JSON.stringify(draft.condition),
        JSON.stringify(draft.actions),
        createdAt,
        updatedAt,
      ],
    );
  }

  private requireRule(id: string): TrapRule {
    const row = this.db.get<RuleRow>('SELECT * FROM trap_rules WHERE id = ?', [id]);
    if (!row) throw new Error(`Trap rule ${id} does not exist`);
    return ruleFromRow(row);
  }

  private id(prefix: string): string {
    return `${prefix}-${[...this.transport.crypto.randomBytes(12)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')}`;
  }
}

function trapFromRow(row: TrapRow): TrapRecord {
  return {
    id: row.id,
    receivedAt: row.received_at,
    sourceAddress: row.source_address,
    sourcePort: row.source_port,
    version: row.version,
    ...(row.security_name ? { securityName: row.security_name } : {}),
    pduType: row.pdu_type,
    varbinds: JSON.parse(row.varbinds_json) as TrapRecord['varbinds'],
    ...(row.trap_oid ? { trapOid: row.trap_oid } : {}),
    ...(row.trap_name ? { trapName: row.trap_name } : {}),
    ...(row.trap_description ? { trapDescription: row.trap_description } : {}),
    expectedObjects: JSON.parse(row.expected_objects_json) as string[],
    missingObjects: JSON.parse(row.missing_objects_json) as string[],
    extraObjects: JSON.parse(row.extra_objects_json) as string[],
    ...(row.raw_pdu_hex ? { rawPduHex: row.raw_pdu_hex } : {}),
    ...(row.parse_error ? { parseError: row.parse_error } : {}),
    ...(row.read_at === null ? {} : { readAt: row.read_at }),
    ...(row.severity ? { severity: row.severity } : {}),
    ...(row.color ? { color: row.color } : {}),
    matchedRuleIds: JSON.parse(row.matched_rule_ids_json) as string[],
  };
}

function ruleFromRow(row: RuleRow): TrapRule {
  return {
    id: row.id,
    name: row.name,
    enabled: !!row.enabled,
    priority: row.priority,
    condition: JSON.parse(row.condition_json) as TrapRule['condition'],
    actions: JSON.parse(row.actions_json) as TrapRule['actions'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function publicV3User(row: V3UserRow): TrapV3UserProfile {
  const security = JSON.parse(row.security_json) as Pick<
    TrapV3UserProfile,
    'level' | 'authProtocol' | 'privProtocol'
  >;
  return {
    name: row.name,
    ...security,
    hasAuthKey: !!row.auth_ref,
    hasPrivKey: !!row.priv_ref,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateV3User(
  draft: TrapV3UserDraft,
  authRef: string | null,
  privRef: string | null,
): void {
  if (draft.level === 'noAuthNoPriv') return;
  if (draft.authProtocol === undefined || !authRef) {
    throw new Error('Authenticated SNMPv3 trap users require an auth protocol and key');
  }
  if (draft.level === 'authNoPriv') return;
  if (draft.privProtocol === undefined || !privRef) {
    throw new Error('Private SNMPv3 trap users require a privacy protocol and key');
  }
}

function requiredName(value: string, kind: string): string {
  const name = value.trim();
  if (!name) throw new Error(`${kind} name is required`);
  return name;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}
