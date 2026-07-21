import type { EngineAPI, PollSeriesDraft } from '@mibbeacon/core/client';
import { toolsPersistentCollectionsController } from './tools-persistent-collections';

export class ToolsCollectionRecoveryRequiredError extends Error {
  constructor(phase: string) {
    super(`Saved Tools state requires recovery before creating a graph (${phase})`);
    this.name = 'ToolsCollectionRecoveryRequiredError';
  }
}

export async function createGraphPollSeries(
  engine: EngineAPI,
  draft: PollSeriesDraft,
  owns: () => boolean,
): Promise<void> {
  if (!owns()) return;
  const controller = toolsPersistentCollectionsController(engine, owns);
  await controller.load();
  if (!owns()) return;
  const snapshot = controller.snapshot();
  const stable =
    snapshot.readiness.phase === 'ready' &&
    ['confirmed', 'success'].includes(snapshot.phase) &&
    snapshot.queued === 0 &&
    snapshot.active === undefined;
  if (!stable) throw new ToolsCollectionRecoveryRequiredError(snapshot.phase);
  // Snapshot validation and enqueue are intentionally synchronous relative to
  // each other, so another mounted caller cannot open a TOCTOU gap here.
  const admitted = controller.createPoll(draft, owns);
  await admitted;
}
