import type { StorageAdapter, Transport } from '@mibbeacon/transport';
import type { AgentSpec } from '../snmp/types';
import type {
  AgentCreateDraft,
  AgentGroup,
  AgentProfile,
  AgentProfileInput,
  AgentSecretsInput,
  AgentUpdateDraft,
  AgentV3Input,
  AgentsAPI,
} from '../api/engine-api';
import { MibBeaconError } from '../errors';

interface AgentRow {
  id: string;
  name: string;
  profile_json: string;
  community_ref: string | null;
  auth_ref: string | null;
  priv_ref: string | null;
  created_at: number;
  updated_at: number;
  last_used_at: number | null;
}

interface StoredProfile extends Required<AgentProfileInput> {
  v3?: AgentV3Input;
}

interface GroupRow {
  id: string;
  name: string;
  agent_ids_json: string;
  created_at: number;
  updated_at: number;
}

export class AgentStore {
  readonly api: Omit<AgentsAPI, 'test'>;

  constructor(
    private readonly db: StorageAdapter,
    private readonly transport: Transport,
    private readonly now: () => number = Date.now,
  ) {
    this.api = {
      list: async () => this.list(),
      get: async (id) => this.get(id),
      create: async (draft) => this.create(draft),
      update: async (id, draft) => this.update(id, draft),
      delete: async (id) => this.delete(id),
      markUsed: async (id) => this.markUsed(id),
      groups: {
        list: async () => this.listGroups(),
        get: async (id) => this.getGroup(id),
        create: async (input) => this.createGroup(input),
        update: async (id, input) => this.updateGroup(id, input),
        delete: async (id) => this.deleteGroup(id),
      },
    };
  }

  private list(): AgentProfile[] {
    return this.db
      .all<AgentRow>(
        `SELECT * FROM agents
         ORDER BY CASE WHEN last_used_at IS NULL THEN 1 ELSE 0 END,
                  last_used_at DESC, updated_at DESC, name COLLATE NOCASE`,
      )
      .map((row) => this.publicProfile(row));
  }

  private get(id: string): AgentProfile | null {
    const row = this.row(id);
    return row ? this.publicProfile(row) : null;
  }

  private async create(draft: AgentCreateDraft): Promise<AgentProfile> {
    const id = this.id('agent');
    const timestamp = this.now();
    const profile = normalizeProfile(draft.profile, draft.v3);
    validateProfile(profile);
    const refs = secretRefs(id);
    const secrets = relevantSecrets(profile, draft.secrets);
    this.requireEncryptedFor(secrets);
    const nextRefs = {
      community: secrets.community ? refs.community : null,
      authKey: secrets.authKey ? refs.authKey : null,
      privKey: secrets.privKey ? refs.privKey : null,
    };
    validateCredentialConfiguration(profile, nextRefs, this.transport);
    const touched = new Map<string, string | null>();
    try {
      for (const [key, value] of Object.entries(secrets) as [keyof AgentSecretsInput, string][]) {
        if (!value) continue;
        touched.set(refs[key], await this.transport.secrets.get(refs[key]));
        await this.transport.secrets.set(refs[key], value);
      }
      this.db.run(
        `INSERT INTO agents
         (id, name, profile_json, community_ref, auth_ref, priv_ref, created_at, updated_at, last_used_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        [
          id,
          profile.name,
          JSON.stringify(profile),
          nextRefs.community,
          nextRefs.authKey,
          nextRefs.privKey,
          timestamp,
          timestamp,
        ],
      );
    } catch (error) {
      await this.rollbackSecrets(touched, error, 'create');
      throw error;
    }
    return this.publicProfileValue(id, profile, nextRefs, timestamp, timestamp, null);
  }

  private async update(id: string, draft: AgentUpdateDraft): Promise<AgentProfile> {
    const current = this.requireRow(id);
    const previous = JSON.parse(current.profile_json) as StoredProfile;
    const profile = normalizeProfile(
      { ...previous, ...(draft.profile ?? {}) },
      draft.v3 === undefined ? previous.v3 : (draft.v3 ?? undefined),
    );
    validateProfile(profile);
    const refs = secretRefs(id);
    const secrets = relevantSecrets(profile, draft.secrets);
    this.requireEncryptedFor(secrets);
    const clear = new Set(draft.clearSecrets ?? []);
    const activeKeys = new Set(activeSecretKeys(profile));
    for (const key of ['community', 'authKey', 'privKey'] as const) {
      if (!activeKeys.has(key)) clear.add(key);
    }
    const nextRefs = {
      community: current.community_ref,
      authKey: current.auth_ref,
      privKey: current.priv_ref,
    };
    const plannedRefs = { ...nextRefs };
    for (const key of ['community', 'authKey', 'privKey'] as const) {
      if (clear.has(key)) plannedRefs[key] = null;
      const value = secrets[key];
      if (value !== undefined) plannedRefs[key] = value ? refs[key] : null;
    }
    validateCredentialConfiguration(profile, plannedRefs, this.transport);
    const timestamp = this.now();
    const touched = new Map<string, string | null>();
    const remember = async (reference: string) => {
      if (!touched.has(reference))
        touched.set(reference, await this.transport.secrets.get(reference));
    };
    try {
      for (const key of ['community', 'authKey', 'privKey'] as const) {
        if (clear.has(key) && nextRefs[key]) {
          await remember(nextRefs[key]!);
          await this.transport.secrets.delete(nextRefs[key]!);
          nextRefs[key] = null;
        }
        const value = secrets[key];
        if (value !== undefined) {
          if (value) {
            await remember(refs[key]);
            await this.transport.secrets.set(refs[key], value);
            nextRefs[key] = refs[key];
          } else if (nextRefs[key]) {
            await remember(nextRefs[key]!);
            await this.transport.secrets.delete(nextRefs[key]!);
            nextRefs[key] = null;
          }
        }
      }
      this.db.run(
        `UPDATE agents SET name = ?, profile_json = ?, community_ref = ?, auth_ref = ?, priv_ref = ?, updated_at = ? WHERE id = ?`,
        [
          profile.name,
          JSON.stringify(profile),
          nextRefs.community,
          nextRefs.authKey,
          nextRefs.privKey,
          timestamp,
          id,
        ],
      );
    } catch (cause) {
      await this.rollbackSecrets(touched, cause, 'update');
      throw cause;
    }
    return this.publicProfileValue(
      id,
      profile,
      nextRefs,
      current.created_at,
      timestamp,
      current.last_used_at,
    );
  }

  private async delete(id: string): Promise<void> {
    const row = this.row(id);
    if (!row) return;
    this.assertNoDeleteDependencies(id);
    const previous = new Map<string, string | null>();
    try {
      for (const reference of [row.community_ref, row.auth_ref, row.priv_ref].filter(
        (value): value is string => !!value,
      )) {
        previous.set(reference, await this.transport.secrets.get(reference));
        await this.transport.secrets.delete(reference);
      }
      this.db.transaction(() => {
        // Close the race between the preflight and awaited secret-store I/O.
        this.assertNoDeleteDependencies(id);
        this.db.run('DELETE FROM agents WHERE id = ?', [id]);
        this.db.run('DELETE FROM settings WHERE key = ?', [`live-mibs.agent.${id}`]);
        for (const group of this.db.all<GroupRow>('SELECT * FROM agent_groups')) {
          const agentIds = (JSON.parse(group.agent_ids_json) as string[]).filter(
            (agentId) => agentId !== id,
          );
          this.db.run('UPDATE agent_groups SET agent_ids_json = ?, updated_at = ? WHERE id = ?', [
            JSON.stringify(agentIds),
            this.now(),
            group.id,
          ]);
        }
      });
    } catch (cause) {
      await this.rollbackSecrets(previous, cause, 'delete');
      throw cause;
    }
  }

  async resolve(id: string): Promise<AgentSpec> {
    const row = this.requireRow(id);
    const profile = JSON.parse(row.profile_json) as StoredProfile;
    const community = row.community_ref
      ? await this.transport.secrets.get(row.community_ref)
      : null;
    const authKey = row.auth_ref ? await this.transport.secrets.get(row.auth_ref) : null;
    const privKey = row.priv_ref ? await this.transport.secrets.get(row.priv_ref) : null;
    return {
      host: profile.host,
      port: profile.port,
      transport: profile.transport,
      version: profile.version,
      timeoutMs: profile.timeoutMs,
      retries: profile.retries,
      ...(community ? { community } : {}),
      ...(profile.v3
        ? {
            v3: {
              ...profile.v3,
              ...(authKey ? { authKey } : {}),
              ...(privKey ? { privKey } : {}),
            },
          }
        : {}),
    };
  }

  private markUsed(id: string): void {
    if (
      this.db.run('UPDATE agents SET last_used_at = ? WHERE id = ?', [this.now(), id]).changes === 0
    ) {
      throw new Error(`Agent ${id} does not exist`);
    }
  }

  private listGroups(): AgentGroup[] {
    return this.db
      .all<GroupRow>('SELECT * FROM agent_groups ORDER BY name COLLATE NOCASE')
      .map(publicGroup);
  }

  private getGroup(id: string): AgentGroup | null {
    const row = this.db.get<GroupRow>('SELECT * FROM agent_groups WHERE id = ?', [id]);
    return row ? publicGroup(row) : null;
  }

  private createGroup(input: { name: string; agentIds: string[] }): AgentGroup {
    const name = requireName(input.name, 'Group');
    const agentIds = this.validateAgentIds(input.agentIds);
    const id = this.id('group');
    const timestamp = this.now();
    this.db.run(
      'INSERT INTO agent_groups (id, name, agent_ids_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [id, name, JSON.stringify(agentIds), timestamp, timestamp],
    );
    return { id, name, agentIds, createdAt: timestamp, updatedAt: timestamp };
  }

  private updateGroup(id: string, input: { name?: string; agentIds?: string[] }): AgentGroup {
    const current = this.db.get<GroupRow>('SELECT * FROM agent_groups WHERE id = ?', [id]);
    if (!current) throw new Error(`Agent group ${id} does not exist`);
    const name = input.name === undefined ? current.name : requireName(input.name, 'Group');
    const agentIds =
      input.agentIds === undefined
        ? (JSON.parse(current.agent_ids_json) as string[])
        : this.validateAgentIds(input.agentIds);
    const timestamp = this.now();
    this.db.run(
      'UPDATE agent_groups SET name = ?, agent_ids_json = ?, updated_at = ? WHERE id = ?',
      [name, JSON.stringify(agentIds), timestamp, id],
    );
    return {
      id,
      name,
      agentIds,
      createdAt: current.created_at,
      updatedAt: timestamp,
    };
  }

  private deleteGroup(id: string): void {
    this.db.run('DELETE FROM agent_groups WHERE id = ?', [id]);
  }

  private validateAgentIds(agentIds: string[]): string[] {
    const unique = [...new Set(agentIds)];
    for (const id of unique) this.requireRow(id);
    return unique;
  }

  private publicProfile(row: AgentRow): AgentProfile {
    const profile = JSON.parse(row.profile_json) as StoredProfile;
    return {
      id: row.id,
      ...profile,
      hasCommunity: !!row.community_ref,
      hasAuthKey: !!row.auth_ref,
      hasPrivKey: !!row.priv_ref,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ...(row.last_used_at === null ? {} : { lastUsedAt: row.last_used_at }),
    };
  }

  private publicProfileValue(
    id: string,
    profile: StoredProfile,
    refs: SecretReferenceSet,
    createdAt: number,
    updatedAt: number,
    lastUsedAt: number | null,
  ): AgentProfile {
    return {
      id,
      ...profile,
      hasCommunity: !!refs.community,
      hasAuthKey: !!refs.authKey,
      hasPrivKey: !!refs.privKey,
      createdAt,
      updatedAt,
      ...(lastUsedAt === null ? {} : { lastUsedAt }),
    };
  }

  private row(id: string): AgentRow | undefined {
    return this.db.get<AgentRow>('SELECT * FROM agents WHERE id = ?', [id]);
  }

  private requireRow(id: string): AgentRow {
    const row = this.row(id);
    if (!row) throw new Error(`Agent ${id} does not exist`);
    return row;
  }

  private requireEncryptedFor(secrets?: AgentSecretsInput): void {
    if (secrets && Object.values(secrets).some(Boolean) && !this.transport.secrets.isEncrypted()) {
      throw new MibBeaconError(
        'SECRET_STORAGE_UNAVAILABLE',
        'Encrypted credential storage is unavailable on this engine host',
        { hint: 'Enable the OS keychain/secure store before saving an agent credential.' },
      );
    }
  }

  private assertNoDeleteDependencies(id: string): void {
    const dependencies = {
      bookmarks:
        this.db.get<{ count: number }>(
          'SELECT COUNT(*) AS count FROM operation_bookmarks WHERE agent_id = ?',
          [id],
        )?.count ?? 0,
      pollSeries:
        this.db.get<{ count: number }>(
          'SELECT COUNT(*) AS count FROM poll_series WHERE agent_id = ?',
          [id],
        )?.count ?? 0,
      trapPresets:
        this.db.get<{ count: number }>(
          'SELECT COUNT(*) AS count FROM trap_send_presets WHERE agent_id = ?',
          [id],
        )?.count ?? 0,
    };
    const blocked = Object.entries(dependencies).filter(([, count]) => count > 0);
    if (!blocked.length) return;
    throw new MibBeaconError(
      'INTERNAL',
      `Agent is still used by ${blocked.map(([kind, count]) => `${kind} (${count})`).join(', ')}`,
      {
        hint: 'Remove or retarget those saved items before deleting the agent.',
        details: dependencies,
      },
    );
  }

  private async rollbackSecrets(
    previous: Map<string, string | null>,
    cause: unknown,
    operation: 'create' | 'update' | 'delete',
  ): Promise<void> {
    const results = await Promise.allSettled(
      [...previous].map(([reference, value]) =>
        value === null
          ? this.transport.secrets.delete(reference)
          : this.transport.secrets.set(reference, value),
      ),
    );
    if (results.some((result) => result.status === 'rejected')) {
      throw new MibBeaconError(
        'INTERNAL',
        `Secret rollback outcome unknown after agent ${operation} failure`,
        { cause },
      );
    }
  }

  private id(prefix: string): string {
    return `${prefix}-${[...this.transport.crypto.randomBytes(12)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')}`;
  }
}

function normalizeProfile(profile: AgentProfileInput, v3?: AgentV3Input): StoredProfile {
  return {
    name: profile.name.trim(),
    host: profile.host.trim(),
    port: profile.port ?? 161,
    transport: profile.transport ?? 'udp4',
    version: profile.version,
    timeoutMs: profile.timeoutMs ?? 5_000,
    retries: profile.retries ?? 1,
    getBulkNonRepeaters: profile.getBulkNonRepeaters ?? 0,
    getBulkMaxRepetitions: profile.getBulkMaxRepetitions ?? 20,
    ...(v3 ? { v3: { ...v3, user: v3.user.trim() } } : {}),
  };
}

function validateProfile(profile: StoredProfile): void {
  requireName(profile.name, 'Agent');
  if (!profile.host) throw new Error('Agent host is required');
  if (!Number.isInteger(profile.port) || profile.port < 1 || profile.port > 65_535) {
    throw new Error('Agent port must be between 1 and 65535');
  }
  if (profile.timeoutMs < 1 || profile.retries < 0) throw new Error('Invalid timeout or retries');
  if (profile.version === 'v3' && !profile.v3?.user) throw new Error('SNMPv3 user is required');
}

type SecretReferenceSet = Record<keyof AgentSecretsInput, string | null>;

function validateCredentialConfiguration(
  profile: StoredProfile,
  refs: SecretReferenceSet,
  transport: Transport,
): void {
  if (profile.version !== 'v3') {
    if (!refs.community) throw new Error(`SNMP ${profile.version} community is required`);
    return;
  }

  const v3 = profile.v3!;
  if (v3.level === 'noAuthNoPriv') return;
  if (!v3.authProtocol) {
    throw new Error(`SNMPv3 ${v3.level} requires an authentication protocol`);
  }
  if (!refs.authKey) {
    throw new Error(`SNMPv3 ${v3.level} requires an authentication password`);
  }
  if (v3.level === 'authNoPriv') return;
  if (!v3.privProtocol) throw new Error('SNMPv3 authPriv requires a privacy protocol');
  if (!refs.privKey) throw new Error('SNMPv3 authPriv requires a privacy password');

  const cipher =
    v3.privProtocol === 'des'
      ? 'des-cbc'
      : v3.privProtocol === 'aes'
        ? 'aes-128-cfb'
        : 'aes-256-cfb';
  if (!transport.crypto.hasCipher(cipher)) {
    const label = v3.privProtocol === 'des' ? 'DES' : v3.privProtocol.toUpperCase();
    throw new Error(
      `${label} privacy is unavailable on this platform; choose a supported privacy protocol`,
    );
  }
}

function activeSecretKeys(profile: StoredProfile): (keyof AgentSecretsInput)[] {
  if (profile.version !== 'v3') return ['community'];
  if (profile.v3?.level === 'noAuthNoPriv') return [];
  if (profile.v3?.level === 'authNoPriv') return ['authKey'];
  return ['authKey', 'privKey'];
}

function relevantSecrets(profile: StoredProfile, secrets?: AgentSecretsInput): AgentSecretsInput {
  const relevant: AgentSecretsInput = {};
  for (const key of activeSecretKeys(profile)) {
    if (secrets?.[key] !== undefined) relevant[key] = secrets[key];
  }
  return relevant;
}

function requireName(name: string, kind: string): string {
  const value = name.trim();
  if (!value) throw new Error(`${kind} name is required`);
  return value;
}

function secretRefs(id: string): Record<keyof AgentSecretsInput, string> {
  return {
    community: `agents/${id}/community`,
    authKey: `agents/${id}/auth-key`,
    privKey: `agents/${id}/priv-key`,
  };
}

function publicGroup(row: GroupRow): AgentGroup {
  return {
    id: row.id,
    name: row.name,
    agentIds: JSON.parse(row.agent_ids_json) as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
