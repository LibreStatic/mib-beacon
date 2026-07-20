import { describe, expect, it } from 'vitest';
import { runLatestLiveMibScanRequest } from './live-mibs-scan-request';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe('latest Live MIB scan request', () => {
  it('cancels a pending start invalidated by a scope change and accepts the replacement', async () => {
    let generation = 1;
    let currentHandle: string | null = null;
    const cancelled: string[] = [];
    const acceptedStatuses: string[] = [];
    const oldScopeStart = deferred<{ handleId: string }>();

    const oldScopeRequest = runLatestLiveMibScanRequest({
      requestId: 1,
      isCurrent: (requestId) => generation === requestId,
      currentHandle: () => currentHandle,
      start: () => oldScopeStart.promise,
      status: async () => 'old scope',
      cancel: async (handleId) => {
        cancelled.push(handleId);
      },
      acceptHandle: (handleId) => {
        currentHandle = handleId;
      },
      acceptStatus: (status) => {
        acceptedStatuses.push(status);
      },
    });

    generation = 2;
    await runLatestLiveMibScanRequest({
      requestId: 2,
      isCurrent: (requestId) => generation === requestId,
      currentHandle: () => currentHandle,
      start: async () => ({ handleId: 'new-scope' }),
      status: async () => 'new scope',
      cancel: async (handleId) => {
        cancelled.push(handleId);
      },
      acceptHandle: (handleId) => {
        currentHandle = handleId;
      },
      acceptStatus: (status) => {
        acceptedStatuses.push(status);
      },
    });

    oldScopeStart.resolve({ handleId: 'old-scope' });
    await oldScopeRequest;

    expect(currentHandle).toBe('new-scope');
    expect(acceptedStatuses).toEqual(['new scope']);
    expect(cancelled).toEqual(['old-scope']);
  });

  it('rejects stale starts and statuses when targets resolve out of order', async () => {
    let generation = 1;
    let currentHandle: string | null = null;
    const acceptedStatuses: string[] = [];
    const cancelled: string[] = [];
    const startA = deferred<{ handleId: string }>();
    const startB = deferred<{ handleId: string }>();
    const statusB = deferred<string | null>();

    const requestA = runLatestLiveMibScanRequest({
      requestId: 1,
      isCurrent: () => generation === 1,
      currentHandle: () => currentHandle,
      start: () => startA.promise,
      status: async () => 'A status',
      cancel: async (handleId) => {
        cancelled.push(handleId);
      },
      acceptHandle: (handleId) => {
        currentHandle = handleId;
      },
      acceptStatus: (status) => {
        acceptedStatuses.push(status);
      },
    });

    generation = 2;
    const requestB = runLatestLiveMibScanRequest({
      requestId: 2,
      isCurrent: () => generation === 2,
      currentHandle: () => currentHandle,
      start: () => startB.promise,
      status: () => statusB.promise,
      cancel: async (handleId) => {
        cancelled.push(handleId);
      },
      acceptHandle: (handleId) => {
        currentHandle = handleId;
      },
      acceptStatus: (status) => {
        acceptedStatuses.push(status);
      },
    });

    startB.resolve({ handleId: 'B' });
    await Promise.resolve();
    generation = 3;
    statusB.resolve('B stale status');
    await requestB;

    startA.resolve({ handleId: 'A' });
    await requestA;

    expect(currentHandle).toBe('B');
    expect(acceptedStatuses).toEqual([]);
    expect(cancelled).toEqual(['A']);
  });
});
