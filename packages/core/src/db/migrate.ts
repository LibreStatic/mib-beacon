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
  const row = db.get<{ value_json: string }>('SELECT value_json FROM settings WHERE key = ?', [key]);
  return row ? (JSON.parse(row.value_json) as T) : undefined;
}

export function setSetting(db: StorageAdapter, key: string, value: unknown): void {
  db.run(
    `INSERT INTO settings (key, value_json) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`,
    [key, JSON.stringify(value)],
  );
}
