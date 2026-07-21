import type { AppAction } from './action-registry';
import type { ResolverCacheClearPhase } from './resolver-cache-transaction';

export interface ResolverCacheClearActionInput {
  readonly entries: number | null;
  readonly phase: ResolverCacheClearPhase;
  readonly execute: () => void | Promise<void>;
}

export function createResolverCacheClearAction({
  entries,
  phase,
  execute,
}: ResolverCacheClearActionInput): AppAction {
  const enabled = resolverCacheClearActionEnabled(entries, phase);
  return {
    id: 'settings:clear-resolver-cache',
    label: 'Clear dependency cache',
    group: 'Settings',
    glyph: '⌫',
    keywords: ['resolver', 'dependency', 'cache', 'clear'],
    keyboard: { suitable: true },
    palette: { exposed: true },
    enabled,
    confirmation: {
      kind: 'destructive',
      title: 'Clear dependency cache?',
      description: 'Cached dependency MIB files will be removed from the engine host.',
    },
    platforms: ['web', 'desktop', 'native'],
    execute,
  };
}

function resolverCacheClearActionEnabled(
  entries: number | null,
  phase: ResolverCacheClearPhase,
): AppAction['enabled'] {
  if (entries === null) return { value: false, reason: 'Cache statistics are still loading.' };
  if (phase === 'queued' || phase === 'updating') {
    return { value: false, reason: 'A cache clear is already in progress.' };
  }
  if (phase === 'uncertain') {
    return { value: false, reason: 'Reconcile the uncertain cache clear before trying again.' };
  }
  if (entries === 0) return { value: false, reason: 'The dependency cache is already empty.' };
  return { value: true };
}
