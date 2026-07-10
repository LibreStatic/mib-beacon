// Validated on-device (spike S3). Compiled by Metro in apps/mobile.
import * as SQLite from 'expo-sqlite';
import type { StorageAdapter, StorageFactory, SqlValue } from '../types';

class ExpoSqliteAdapter implements StorageAdapter {
  private db: SQLite.SQLiteDatabase;

  constructor(filePath: string) {
    this.db = SQLite.openDatabaseSync(filePath);
    this.db.execSync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  }

  exec(sql: string): void {
    this.db.execSync(sql);
  }

  run(sql: string, params: SqlValue[] = []) {
    const r = this.db.runSync(sql, params as SQLite.SQLiteBindValue[]);
    return { changes: r.changes, lastInsertRowid: Number(r.lastInsertRowId) };
  }

  get<T = Record<string, SqlValue>>(sql: string, params: SqlValue[] = []): T | undefined {
    return this.db.getFirstSync<T>(sql, params as SQLite.SQLiteBindValue[]) ?? undefined;
  }

  all<T = Record<string, SqlValue>>(sql: string, params: SqlValue[] = []): T[] {
    return this.db.getAllSync<T>(sql, params as SQLite.SQLiteBindValue[]);
  }

  transaction<T>(fn: () => T): T {
    let result!: T;
    this.db.withTransactionSync(() => {
      result = fn();
    });
    return result;
  }

  close(): void {
    this.db.closeSync();
  }
}

export const rnStorageFactory: StorageFactory = {
  open: (filePath) => new ExpoSqliteAdapter(filePath),
};
