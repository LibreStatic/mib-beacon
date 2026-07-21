import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { ActionPlatform, ActionRegistry, AppAction } from './action-registry';

const ActionRegistryContext = createContext<ActionRegistry | null>(null);
const ActionPlatformContext = createContext<ActionPlatform | null>(null);

export function ActionRegistryProvider({
  registry,
  platform,
  children,
}: {
  registry: ActionRegistry;
  platform: ActionPlatform;
  children: ReactNode;
}) {
  return (
    <ActionRegistryContext.Provider value={registry}>
      <ActionPlatformContext.Provider value={platform}>{children}</ActionPlatformContext.Provider>
    </ActionRegistryContext.Provider>
  );
}

export function useActionRegistry(): ActionRegistry {
  const registry = useContext(ActionRegistryContext);
  if (!registry) throw new Error('useActionRegistry requires an ActionRegistryProvider.');
  return registry;
}

export function useActionPlatform(): ActionPlatform {
  const platform = useContext(ActionPlatformContext);
  if (!platform) throw new Error('useActionPlatform requires an ActionRegistryProvider.');
  return platform;
}

export function useActionRegistrySnapshot(): readonly AppAction[] {
  const registry = useActionRegistry();
  return useSyncExternalStore(
    (listener) => registry.subscribe(listener),
    () => registry.snapshot(),
    () => registry.snapshot(),
  );
}

export function useRegisteredActions(actions: readonly AppAction[]): void {
  const registry = useActionRegistry();
  const owner = useRef(Symbol('registered-actions'));
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => {
    cleanup.current = registry.replaceMany(owner.current, actions);
  }, [actions, registry]);
  useEffect(
    () => () => {
      cleanup.current?.();
      cleanup.current = null;
    },
    [registry],
  );
}
