import type { EngineAPI } from '@mibbeacon/core/client';
import { performTrapRecordMutation, type StoreWriteOwnership } from './actions';
import { useAppStore } from './store';

const alwaysOwns = () => true;

export async function clearPacketHistory(
  engine: EngineAPI,
  owns: StoreWriteOwnership = alwaysOwns,
): Promise<void> {
  await engine.packets.clear();
  if (owns()) useAppStore.getState().clearPacketEvents();
}

export async function resumePacketHistory(
  engine: EngineAPI,
  owns: StoreWriteOwnership = alwaysOwns,
): Promise<void> {
  const history = await engine.packets.history();
  if (!owns()) return;
  useAppStore.getState().setPacketEvents(history);
  useAppStore.getState().setPacketFeedPaused(false);
}

export async function clearTrapCapture(
  engine: EngineAPI,
  owns: StoreWriteOwnership = alwaysOwns,
): Promise<void> {
  return performTrapRecordMutation(
    engine,
    '*',
    'clear',
    () => engine.traps.clear(),
    () => useAppStore.getState().clearTraps(),
    owns,
  );
}
