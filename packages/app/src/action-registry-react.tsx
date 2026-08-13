import {
  useCallback,
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type {
  ActionConfirmationAuthorizer,
  ActionPlatform,
  ActionRegistry,
  AppAction,
} from './action-registry';
import { dispatchRegisteredAction } from './action-dispatch';
import { assertCatalogOwnerActions, type KeyboardActionOwner } from './keyboard-action-catalog';

const ActionRegistryContext = createContext<ActionRegistry | null>(null);
const ActionPlatformContext = createContext<ActionPlatform | null>(null);
const ActionConfirmationContext = createContext<ActionConfirmationAuthorizer | undefined>(
  undefined,
);

export function ActionRegistryProvider({
  registry,
  platform,
  children,
  authorizeConfirmation,
}: {
  registry: ActionRegistry;
  platform: ActionPlatform;
  children: ReactNode;
  authorizeConfirmation?: ActionConfirmationAuthorizer;
}) {
  return (
    <ActionRegistryContext.Provider value={registry}>
      <ActionPlatformContext.Provider value={platform}>
        <ActionConfirmationContext.Provider value={authorizeConfirmation}>
          {children}
        </ActionConfirmationContext.Provider>
      </ActionPlatformContext.Provider>
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

export function useRegisteredActions(actions: readonly AppAction[], priority = 0): void {
  const registry = useActionRegistry();
  const owner = useRef(Symbol('registered-actions'));
  useLayoutEffect(() => {
    return registry.replaceMany(owner.current, actions, { priority });
  }, [actions, priority, registry]);
}

export function useRegisteredCatalogActions(
  owner: KeyboardActionOwner,
  actions: readonly AppAction[],
): void {
  assertCatalogOwnerActions(owner, actions);
  useRegisteredActions(actions, 100);
}

export function useRegisteredActionDispatcher(
  onError: (message: string) => void,
): (actionId: string) => Promise<boolean> {
  const registry = useActionRegistry();
  const platform = useActionPlatform();
  const authorizeConfirmation = useContext(ActionConfirmationContext);
  return useCallback(
    (actionId: string) =>
      dispatchRegisteredAction(registry, actionId, platform, onError, authorizeConfirmation),
    [authorizeConfirmation, onError, platform, registry],
  );
}
