import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FileImportReview } from './file-import';
import { buildFileImportReview, prepareFileImport } from './file-import';
import { useAppStore } from './store';

let review: FileImportReview;

describe('persisted file import review draft', () => {
  beforeAll(async () => {
    review = buildFileImportReview(
      await prepareFileImport([{ name: 'one.mib', bytes: new TextEncoder().encode('ONE-MIB DEFINITIONS ::= BEGIN\nEND') }]),
      [], [], new Map(),
    );
  });
  beforeEach(() => {
    useAppStore.setState({ fileImportDraft: null, importStatus: null });
  });

  it('survives consumer unmount/remount and reopens the same selection after failure', () => {
    useAppStore.getState().setFileImportDraft({
      review,
      selected: ['one.mib'],
      replacements: ['ONE-MIB'],
      handleId: null,
      visible: true,
    });

    // The MIB screen is conditionally mounted by AppRoot. Reading through a new
    // consumer after its old owner disappears must return the store snapshot.
    const beforeUnmount = useAppStore.getState().fileImportDraft;
    expect(beforeUnmount?.selected).toEqual(['one.mib']);
    const afterRemount = useAppStore.getState().fileImportDraft;
    expect(afterRemount?.review).toBe(review);

    useAppStore.getState().acceptFileImportDraft('accepted-1');
    expect(useAppStore.getState().fileImportDraft).toEqual(expect.objectContaining({ handleId: 'accepted-1', visible: false }));
    useAppStore.getState().settleFileImportDraft('stale-handle', 'error');
    expect(useAppStore.getState().fileImportDraft?.visible).toBe(false);
    useAppStore.getState().settleFileImportDraft('accepted-1', 'partial');
    expect(useAppStore.getState().fileImportDraft).toEqual(expect.objectContaining({
      handleId: null,
      visible: true,
      selected: ['one.mib'],
      replacements: ['ONE-MIB'],
      reopenMessage: expect.stringContaining('partial'),
    }));
  });

  it('clears only a matching successful snapshot and handles terminal-before-accept races', () => {
    useAppStore.getState().setFileImportDraft({ review, selected: ['one.mib'], replacements: [], handleId: null, visible: true });
    useAppStore.setState({ importStatus: {
      handleId: 'fast-1', state: 'error', startedAt: 1, updatedAt: 2,
      missingModules: [], sourceHosts: [], loadedModules: [], failures: [],
    } });
    useAppStore.getState().acceptFileImportDraft('fast-1');
    expect(useAppStore.getState().fileImportDraft).toEqual(expect.objectContaining({ visible: true, handleId: null }));

    useAppStore.setState({ importStatus: null });
    useAppStore.getState().acceptFileImportDraft('retry-1');
    useAppStore.getState().settleFileImportDraft('retry-1', 'done');
    expect(useAppStore.getState().fileImportDraft).toBeNull();
  });
});
