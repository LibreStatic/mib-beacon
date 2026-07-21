import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  Fragment,
} from 'react';
import type { EngineAPI } from '@mibbeacon/core/client';
import type { EngineLifetimeCoordinator } from './engine-lifetime-coordinator';
import { EngineOwnershipSlot } from './engine-ownership-slot';
import { EngineEpochSlot } from './engine-epoch';

interface EngineContextValue {
  engine: EngineAPI;
  owns: () => boolean;
}

const EngineContext = createContext<EngineContextValue | null>(null);

/**
 * The host injects a concrete EngineAPI: on desktop the IPC proxy
 * (window.mibbeaconEngine), on mobile an in-process engine. UI code depends only on
 * the EngineAPI *type* from @mibbeacon/core — never the implementation.
 */
export function EngineProvider({ engine, children }: { engine: EngineAPI; children: ReactNode }) {
  const lifetimeRef = useRef<EngineOwnershipSlot<EngineAPI> | null>(null);
  const epochRef = useRef<EngineEpochSlot<EngineAPI> | null>(null);
  lifetimeRef.current ??= new EngineOwnershipSlot<EngineAPI>();
  epochRef.current ??= new EngineEpochSlot<EngineAPI>();
  const coordinator: EngineLifetimeCoordinator = lifetimeRef.current.claim(engine);
  const [activation, setActivation] = useState(0);
  useEffect(() => {
    if (!coordinator.isActive()) {
      coordinator.activate();
      setActivation((value) => value + 1);
    }
    return () => coordinator.dispose();
  }, [coordinator]);
  const token = useMemo(() => {
    void activation;
    return coordinator.capture('provider-lifetime');
  }, [activation, coordinator]);
  const owns = useCallback(() => coordinator.owns(token), [coordinator, token]);
  const value = useMemo(() => ({ engine, owns }), [engine, owns]);
  return (
    <EngineContext.Provider value={value}>
      <Fragment key={epochRef.current.key(engine)}>{children}</Fragment>
    </EngineContext.Provider>
  );
}

export function useEngine(): EngineAPI {
  const value = useContext(EngineContext);
  if (!value) throw new Error('useEngine must be used within an EngineProvider');
  return value.engine;
}

export function useEngineOwnership(): () => boolean {
  const value = useContext(EngineContext);
  if (!value) throw new Error('useEngineOwnership must be used within an EngineProvider');
  return value.owns;
}
