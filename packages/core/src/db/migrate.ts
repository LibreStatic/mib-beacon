import type { StorageAdapter } from '@omc/transport';

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
