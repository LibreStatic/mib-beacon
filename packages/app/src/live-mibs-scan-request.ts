export interface LatestLiveMibScanRequest<TStatus> {
  requestId: number;
  isCurrent: (requestId: number) => boolean;
  currentHandle: () => string | null;
  start: () => Promise<{ handleId: string }>;
  status: (handleId: string) => Promise<TStatus | null>;
  cancel: (handleId: string) => Promise<unknown>;
  acceptHandle: (handleId: string) => void;
  acceptStatus: (status: TStatus) => void;
}

/**
 * Accepts a scan handle and its initial status only while its target/request
 * generation is still current. A handle created after invalidation is
 * cancelled immediately so it cannot leak work or events into the next target.
 */
export async function runLatestLiveMibScanRequest<TStatus>({
  requestId,
  isCurrent,
  currentHandle,
  start,
  status,
  cancel,
  acceptHandle,
  acceptStatus,
}: LatestLiveMibScanRequest<TStatus>): Promise<void> {
  const { handleId } = await start();
  if (!isCurrent(requestId)) {
    try {
      await cancel(handleId);
    } catch {
      // The request is already stale; cancellation is best-effort cleanup.
    }
    return;
  }

  acceptHandle(handleId);
  const initialStatus = await status(handleId);
  if (
    initialStatus &&
    isCurrent(requestId) &&
    currentHandle() === handleId
  )
    acceptStatus(initialStatus);
}
