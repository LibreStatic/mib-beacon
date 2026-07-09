import { DatabaseSync } from 'node:sqlite';
import type { StorageAdapter, StorageFactory, SqlValue } from '../types.js';

/**
 * Backed by Node's built-in `node:sqlite` (stable since Node 22, bundled in
 * modern Electron). Chosen over better-sqlite3 to avoid native compilation,
 * which does not build against Node 26's V8. See docs/plans/02 Deviations.
 */
class NodeSqliteAdapter implements StorageAdapter {
  private db: DatabaseSync;

  constructor(filePath: string) {
    this.db = new DatabaseSync(filePath);
    if (filePath !== ':memory:') {
      this.db.exec('PRAGMA journal_mode = WAL;');
    }
    this.db.exec('PRAGMA foreign_keys = ON;');
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  run(sql: string, params: SqlValue[] = []) {
    const info = this.db.prepare(sql).run(...params);
    return { changes: Number(info.changes), lastInsertRowid: Number(info.lastInsertRowid) };
  }

  get<T = Record<string, SqlValue>>(sql: string, params: SqlValue[] = []): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  all<T = Record<string, SqlValue>>(sql: string, params: SqlValue[] = []): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  close(): void {
    this.db.close();
  }
}

export const nodeStorageFactory: StorageFactory = {
  open: (filePath) => new NodeSqliteAdapter(filePath),
};
