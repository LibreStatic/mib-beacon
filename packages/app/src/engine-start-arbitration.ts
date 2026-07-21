import type { EngineAPI } from '@mibbeacon/core/client';

export interface EngineStartClaim {
  engine: EngineAPI;
  resource: string;
  generation: number;
}

export class EngineStartArbitration {
  private readonly generations = new WeakMap<EngineAPI, Map<string, number>>();

  begin(engine: EngineAPI, resource: string): EngineStartClaim {
    let resources = this.generations.get(engine);
    if (!resources) {
      resources = new Map();
      this.generations.set(engine, resources);
    }
    const generation = (resources.get(resource) ?? 0) + 1;
    resources.set(resource, generation);
    return { engine, resource, generation };
  }

  isCurrent(claim: EngineStartClaim, owns: () => boolean): boolean {
    return owns() && this.generations.get(claim.engine)?.get(claim.resource) === claim.generation;
  }

  async accept(
    claim: EngineStartClaim,
    handleId: string,
    owns: () => boolean,
    cancel: (handleId: string) => Promise<unknown>,
    commit: (handleId: string) => void,
  ): Promise<boolean> {
    if (!this.isCurrent(claim, owns)) {
      await cancel(handleId).catch(() => undefined);
      return false;
    }
    commit(handleId);
    return true;
  }
}

export const engineStartArbitration = new EngineStartArbitration();

export function reportCurrentStartError(
  arbitration: EngineStartArbitration,
  claim: EngineStartClaim,
  owns: () => boolean,
  report: (error: unknown) => void,
  error: unknown,
): void {
  if (arbitration.isCurrent(claim, owns)) report(error);
}

export async function cleanupAcceptedEngineHandles(
  engine: EngineAPI,
  handles: {
    running: string | null;
    importHandle: string | null;
    sourceTestHandles?: Record<string, string>;
    sourcePreviewHandle?: string | null;
  },
): Promise<void> {
  await Promise.allSettled([
    ...(handles.running ? [engine.ops.cancel(handles.running)] : []),
    ...(handles.importHandle ? [engine.resolver.cancel(handles.importHandle)] : []),
    ...Object.values(handles.sourceTestHandles ?? {}).map((handleId) =>
      engine.resolver.cancel(handleId),
    ),
    ...(handles.sourcePreviewHandle ? [engine.resolver.cancel(handles.sourcePreviewHandle)] : []),
  ]);
}
