import type { StorageAdapter } from '@mibbeacon/transport';

export interface Migration {
  id: number;
  name: string;
  up: string;
}

/**
 * Ordered migrations. Each feature phase appends its tables here (agents,
 * mib_modules, traps, …). The spike only needs schema_migrations + settings.
 */
export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'init',
    up: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL
      );
    `,
  },
  {
    id: 2,
    name: 'mib_modules',
    up: `
      CREATE TABLE IF NOT EXISTS mib_modules (
        name TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        loaded_at INTEGER NOT NULL
      );
    `,
  },
  {
    id: 3,
    name: 'resolver',
    up: `
      CREATE TABLE IF NOT EXISTS resolver_sources (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL,
        enabled INTEGER NOT NULL, priority INTEGER NOT NULL,
        built_in INTEGER NOT NULL DEFAULT 0, config_json TEXT NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS resolver_cache (
        module TEXT PRIMARY KEY, content_key TEXT NOT NULL,
        source_id TEXT NOT NULL, location TEXT NOT NULL,
        warnings_json TEXT NOT NULL, size_bytes INTEGER NOT NULL,
        etag TEXT, stored_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS resolver_source_indexes (
        source_id TEXT NOT NULL, index_key TEXT NOT NULL,
        value_json TEXT NOT NULL, etag TEXT, updated_at INTEGER NOT NULL,
        PRIMARY KEY(source_id, index_key)
      );
      CREATE TABLE IF NOT EXISTS resolver_lookup_cache (
        kind TEXT NOT NULL, lookup_key TEXT NOT NULL, value_json TEXT NOT NULL,
        expires_at INTEGER NOT NULL, stored_at INTEGER NOT NULL,
        PRIMARY KEY(kind, lookup_key)
      );
      CREATE TABLE IF NOT EXISTS resolver_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT, handle_id TEXT NOT NULL,
        status TEXT NOT NULL, requested_json TEXT NOT NULL,
        result_json TEXT NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS resolver_cooldowns (
        source_id TEXT PRIMARY KEY, http_status INTEGER NOT NULL,
        until_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
    `,
  },
  {
    id: 4,
    name: 'mib_content_addresses',
    up: `ALTER TABLE mib_modules ADD COLUMN content_key TEXT;`,
  },
  {
    id: 5,
    name: 'agents_and_groups',
    up: `
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        profile_json TEXT NOT NULL,
        community_ref TEXT,
        auth_ref TEXT,
        priv_ref TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_used_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS agent_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        agent_ids_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `,
  },
  {
    id: 6,
    name: 'query_artifacts',
    up: `
      CREATE TABLE IF NOT EXISTS operation_bookmarks (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, agent_id TEXT NOT NULL,
        oid TEXT NOT NULL, operation TEXT NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS walk_snapshots (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, agent_name TEXT NOT NULL,
        base_oid TEXT NOT NULL, file_path TEXT NOT NULL,
        result_count INTEGER NOT NULL, created_at INTEGER NOT NULL
      );
    `,
  },
  {
    id: 7,
    name: 'traps',
    up: `
      CREATE TABLE IF NOT EXISTS traps (
        id TEXT PRIMARY KEY,
        received_at INTEGER NOT NULL,
        source_address TEXT NOT NULL,
        source_port INTEGER NOT NULL,
        version INTEGER NOT NULL,
        security_name TEXT,
        pdu_type INTEGER NOT NULL,
        trap_oid TEXT,
        trap_name TEXT,
        trap_description TEXT,
        expected_objects_json TEXT NOT NULL DEFAULT '[]',
        missing_objects_json TEXT NOT NULL DEFAULT '[]',
        extra_objects_json TEXT NOT NULL DEFAULT '[]',
        varbinds_json TEXT NOT NULL,
        raw_pdu_hex TEXT,
        parse_error TEXT,
        read_at INTEGER,
        severity TEXT,
        color TEXT,
        matched_rule_ids_json TEXT NOT NULL DEFAULT '[]'
      );
      CREATE INDEX IF NOT EXISTS traps_received_at_idx ON traps(received_at DESC);
      CREATE INDEX IF NOT EXISTS traps_source_idx ON traps(source_address);
      CREATE INDEX IF NOT EXISTS traps_oid_idx ON traps(trap_oid);
      CREATE INDEX IF NOT EXISTS traps_unread_idx ON traps(read_at, received_at DESC);

      CREATE TABLE IF NOT EXISTS trap_v3_users (
        name TEXT PRIMARY KEY,
        security_json TEXT NOT NULL,
        auth_ref TEXT,
        priv_ref TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS trap_saved_filters (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        query_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS trap_send_presets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        agent_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS trap_rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        priority INTEGER NOT NULL,
        condition_json TEXT NOT NULL,
        actions_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS trap_rules_priority_idx ON trap_rules(enabled, priority);
    `,
  },
  {
    id: 8,
    name: 'resolver_source_stats',
    up: `
      CREATE TABLE IF NOT EXISTS resolver_source_stats (
        source_id TEXT PRIMARY KEY,
        last_used_at INTEGER,
        last_result TEXT,
        cache_hits INTEGER NOT NULL DEFAULT 0
      );
    `,
  },
  {
    id: 9,
    name: 'tools_suite',
    up: `
      CREATE TABLE IF NOT EXISTS poll_series (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        oid TEXT NOT NULL,
        interval_ms INTEGER NOT NULL,
        mode TEXT NOT NULL,
        counter_bits INTEGER NOT NULL DEFAULT 64,
        retention INTEGER NOT NULL DEFAULT 10000,
        paused INTEGER NOT NULL DEFAULT 0,
        error_count INTEGER NOT NULL DEFAULT 0,
        next_due_at INTEGER NOT NULL,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS poll_series_schedule_idx ON poll_series(paused, next_due_at, agent_id, interval_ms);
      CREATE TABLE IF NOT EXISTS poll_samples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        series_id TEXT NOT NULL,
        sampled_at INTEGER NOT NULL,
        raw_value TEXT NOT NULL,
        value REAL,
        type_name TEXT,
        FOREIGN KEY(series_id) REFERENCES poll_series(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS poll_samples_series_time_idx ON poll_samples(series_id, sampled_at DESC);
      CREATE TABLE IF NOT EXISTS poll_watches (
        id TEXT PRIMARY KEY,
        series_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        operator TEXT,
        threshold REAL,
        threshold_mode TEXT NOT NULL DEFAULT 'value',
        breaching INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(series_id) REFERENCES poll_series(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS poll_charts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        series_ids_json TEXT NOT NULL,
        hidden_series_ids_json TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `,
  },
];

/** Apply any migrations newer than the recorded version. Idempotent. */
export function runMigrations(db: StorageAdapter, migrations: Migration[] = MIGRATIONS): number {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL
  );`);
  const row = db.get<{ max: number | null }>('SELECT MAX(id) AS max FROM schema_migrations');
  const current = row?.max ?? 0;
  let applied = 0;
  for (const m of migrations.slice().sort((a, b) => a.id - b.id)) {
    if (m.id <= current) continue;
    db.transaction(() => {
      db.exec(m.up);
      db.run('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)', [
        m.id,
        m.name,
        Date.now(),
      ]);
    });
    applied++;
  }
  return applied;
}

export function getSetting<T>(db: StorageAdapter, key: string): T | undefined {
  const row = db.get<{ value_json: string }>('SELECT value_json FROM settings WHERE key = ?', [
    key,
  ]);
  return row ? (JSON.parse(row.value_json) as T) : undefined;
}

export function setSetting(db: StorageAdapter, key: string, value: unknown): void {
  db.run(
    `INSERT INTO settings (key, value_json) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`,
    [key, JSON.stringify(value)],
  );
}
