import { describe, it, expect } from 'vitest';
import { nodeStorageFactory } from '@mibbeacon/transport/node';
import { runMigrations, getSetting, setSetting, MIGRATIONS } from './migrate';

describe('runMigrations', () => {
  it('applies the initial migration and is idempotent', () => {
    const db = nodeStorageFactory.open(':memory:');
    expect(runMigrations(db)).toBe(MIGRATIONS.length);
    // second run applies nothing
    expect(runMigrations(db)).toBe(0);
    const tables = db.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    );
    const names = tables.map((t) => t.name);
    expect(names).toContain('schema_migrations');
    expect(names).toContain('settings');
    expect(names).toEqual(
      expect.arrayContaining([
        'resolver_sources',
        'resolver_cache',
        'resolver_source_indexes',
        'resolver_lookup_cache',
        'resolver_history',
        'resolver_cooldowns',
      ]),
    );
    db.close();
  });

  it('round-trips settings as JSON', () => {
    const db = nodeStorageFactory.open(':memory:');
    runMigrations(db);
    expect(getSetting(db, 'missing')).toBeUndefined();
    setSetting(db, 'resolver.enabled', false);
    setSetting(db, 'trap.port', 1162);
    expect(getSetting<boolean>(db, 'resolver.enabled')).toBe(false);
    expect(getSetting<number>(db, 'trap.port')).toBe(1162);
    // upsert overwrites
    setSetting(db, 'resolver.enabled', true);
    expect(getSetting<boolean>(db, 'resolver.enabled')).toBe(true);
    db.close();
  });
});
