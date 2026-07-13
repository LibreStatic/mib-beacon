import { createContext, useContext, type ReactNode } from 'react';
import type { EngineAPI } from '@mibbeacon/core/client';

const EngineContext = createContext<EngineAPI | null>(null);

/**
 * The host injects a concrete EngineAPI: on desktop the IPC proxy
 * (window.mibbeaconEngine), on mobile an in-process engine. UI code depends only on
 * the EngineAPI *type* from @mibbeacon/core — never the implementation.
 */
export function EngineProvider({ engine, children }: { engine: EngineAPI; children: ReactNode }) {
  return <EngineContext.Provider value={engine}>{children}</EngineContext.Provider>;
}

export function useEngine(): EngineAPI {
  const engine = useContext(EngineContext);
  if (!engine) throw new Error('useEngine must be used within an EngineProvider');
  return engine;
}
