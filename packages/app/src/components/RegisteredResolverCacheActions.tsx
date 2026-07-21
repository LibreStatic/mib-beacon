import { useMemo, useSyncExternalStore } from 'react';
import { clearResolverCache, resolverCacheClearController } from '../actions';
import { useRegisteredActions } from '../action-registry-react';
import { useEngine, useEngineOwnership } from '../engine-context';
import { createResolverCacheClearAction } from '../resolver-cache-action';
import { useAppStore } from '../store';

/** Keeps the resolver-cache command available independently of the active screen. */
export function RegisteredResolverCacheActions() {
  const engine = useEngine();
  const ownsEngine = useEngineOwnership();
  const entries = useAppStore((state) => state.resolverCache?.entries ?? null);
  const controller = useMemo(
    () => resolverCacheClearController(engine, ownsEngine),
    [engine, ownsEngine],
  );
  const state = useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.snapshot(),
    () => controller.snapshot(),
  );
  const actions = useMemo(
    () => [
      createResolverCacheClearAction({
        entries,
        phase: state.phase,
        execute: () => clearResolverCache(engine, ownsEngine),
      }),
    ],
    [engine, entries, ownsEngine, state.phase],
  );
  useRegisteredActions(actions);
  return null;
}
