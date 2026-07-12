import { describe, expect, it } from 'vitest';

import { BUILTIN_SOURCE_CONFIGS } from './builtins';

describe('BUILTIN_SOURCE_CONFIGS', () => {
  it('seeds the documented source priority and disables Circitor', () => {
    expect(BUILTIN_SOURCE_CONFIGS.map(({ id }) => id)).toEqual([
      'cache',
      'pysnmp',
      'pysnmp-github',
      'librenms',
      'cisco',
      'netdisco',
      'mibbrowser-online',
      'circitor',
    ]);
    expect(BUILTIN_SOURCE_CONFIGS.map(({ priority }) => priority)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(BUILTIN_SOURCE_CONFIGS.at(-1)?.enabled).toBe(false);
    expect(BUILTIN_SOURCE_CONFIGS.every(({ builtIn }) => builtIn)).toBe(true);
  });
});

it('creates the configured external adapters while cache remains the resolver cache', async () => {
  const { createBuiltinSources } = await import('./builtins');
  const sources = createBuiltinSources({
    async fetch() {
      return { status: 404, ok: false, headers: {}, text: '', bytes: 0 };
    },
  });
  expect(sources.map(({ id }) => id)).toEqual([
    'pysnmp', 'pysnmp-github', 'librenms', 'cisco', 'netdisco', 'mibbrowser-online', 'circitor',
  ]);
  expect(sources.map(({ kind }) => kind)).toEqual([
    'http-template', 'http-template', 'github-tree', 'http-template', 'github-tree', 'http-template', 'http-template',
  ]);
});
