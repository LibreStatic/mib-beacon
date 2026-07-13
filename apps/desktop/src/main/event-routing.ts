export interface RoutableEngineEvent {
  kind: string;
  handleId?: string;
}

export function getEventRecipientIds(
  event: RoutableEngineEvent,
  windowIds: number[],
  ownerByHandle: ReadonlyMap<string, number>,
  fallbackId?: number,
): number[] {
  if (event.kind !== 'consent-required') return windowIds;
  const ownerId = event.handleId ? ownerByHandle.get(event.handleId) : undefined;
  if (ownerId !== undefined && windowIds.includes(ownerId)) return [ownerId];
  if (fallbackId !== undefined && windowIds.includes(fallbackId)) return [fallbackId];
  return windowIds.length ? [windowIds[0]!] : [];
}
