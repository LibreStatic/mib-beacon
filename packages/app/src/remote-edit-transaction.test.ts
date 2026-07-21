import { describe, expect, it } from 'vitest';
import {
  acknowledgeRemoteEditError,
  beginRemoteEdit,
  canCancelRemoteEdit,
  createRemoteEditState,
  editRemoteDraft,
  getRemoteEditDisplayValue,
  markRemoteEditUncertain,
  queueRemoteEdit,
  reconcileRemoteEdit,
  rejectRemoteEdit,
  succeedRemoteEdit,
  structuralRemoteEditEquality,
} from './remote-edit-transaction';

describe('remote edit transaction', () => {
  it('never permits cancel while an active or queued request can still complete', () => {
    const updating = beginRemoteEdit(
      queueRemoteEdit(editRemoteDraft(createRemoteEditState('agent:one', 'A'), 'B'), 1),
      'agent:one',
      1,
    );
    const dirtyWithActive = editRemoteDraft(updating, 'C');
    const queuedWithActive = queueRemoteEdit(dirtyWithActive, 2);

    expect(canCancelRemoteEdit(dirtyWithActive)).toBe(false);
    expect(canCancelRemoteEdit(queuedWithActive)).toBe(false);
    expect(canCancelRemoteEdit(editRemoteDraft(createRemoteEditState('agent:one', 'A'), 'B'))).toBe(
      true,
    );
  });

  it('initializes authoritative data and tracks local drafts separately', () => {
    const initial = createRemoteEditState('agent:one', { enabled: false });
    expect(initial).toMatchObject({
      scopeKey: 'agent:one',
      confirmed: { enabled: false },
      draft: { enabled: false },
      phase: 'confirmed',
      requestId: 0,
    });

    expect(editRemoteDraft(initial, { enabled: true })).toMatchObject({
      scopeKey: 'agent:one',
      confirmed: { enabled: false },
      draft: { enabled: true },
      phase: 'dirty',
      requestId: 0,
    });
  });

  it('moves the current request through queued, updating, and success', () => {
    const dirty = editRemoteDraft(createRemoteEditState('agent:one', 'old'), 'new');
    const queued = queueRemoteEdit(dirty, 7);
    const updating = beginRemoteEdit(queued, 'agent:one', 7);

    expect(queued).toMatchObject({ phase: 'queued', requestId: 7 });
    expect(updating).toMatchObject({ phase: 'updating', requestId: 7 });
    expect(succeedRemoteEdit(updating, 'agent:one', 7, 'saved')).toMatchObject({
      scopeKey: 'agent:one',
      confirmed: 'saved',
      draft: 'saved',
      phase: 'success',
      requestId: 7,
    });
  });

  it('ignores stale responses and responses from a prior scope', () => {
    const updating = beginRemoteEdit(
      queueRemoteEdit(editRemoteDraft(createRemoteEditState('agent:two', 'old'), 'new'), 9),
      'agent:two',
      9,
    );

    expect(succeedRemoteEdit(updating, 'agent:two', 8, 'stale')).toBe(updating);
    expect(rejectRemoteEdit(updating, 'agent:one', 9, 'wrong scope')).toBe(updating);
    expect(markRemoteEditUncertain(updating, 'agent:two', 8, 'stale')).toBe(updating);
  });

  it('preserves a newer queued draft while an older request succeeds', () => {
    const updatingB = beginRemoteEdit(
      queueRemoteEdit(editRemoteDraft(createRemoteEditState('agent:one', 'A'), 'B'), 1),
      'agent:one',
      1,
    );
    const dirtyC = editRemoteDraft(updatingB, 'C');
    const queuedC = queueRemoteEdit(dirtyC, 2);

    expect(queuedC).toMatchObject({
      confirmed: 'A',
      draft: 'C',
      phase: 'queued',
      requestId: 2,
      activeRequest: { requestId: 1, submitted: 'B' },
      queuedRequest: { requestId: 2, submitted: 'C' },
    });
    expect(beginRemoteEdit(queuedC, 'agent:one', 2)).toBe(queuedC);

    const afterB = succeedRemoteEdit(queuedC, 'agent:one', 1, 'B');
    expect(afterB).toMatchObject({
      confirmed: 'B',
      draft: 'C',
      phase: 'queued',
      requestId: 2,
      queuedRequest: { requestId: 2, submitted: 'C' },
    });
    expect(afterB).not.toHaveProperty('activeRequest');

    const updatingC = beginRemoteEdit(afterB, 'agent:one', 2);
    expect(rejectRemoteEdit(updatingC, 'agent:one', 2, 'rejected C')).toMatchObject({
      confirmed: 'B',
      draft: 'B',
      phase: 'error-reverted',
      requestId: 2,
      error: 'rejected C',
    });
  });

  it('requires acknowledgement after rejecting an active request with a newer draft', () => {
    const updatingB = beginRemoteEdit(
      queueRemoteEdit(editRemoteDraft(createRemoteEditState('agent:one', 'A'), 'B'), 1),
      'agent:one',
      1,
    );
    const dirtyC = editRemoteDraft(updatingB, 'C');
    const rejectedB = rejectRemoteEdit(dirtyC, 'agent:one', 1, 'B was rejected');

    expect(rejectedB).toMatchObject({
      confirmed: 'A',
      draft: 'C',
      phase: 'error-reverted',
      requestId: 1,
      error: 'B was rejected',
    });
    expect(getRemoteEditDisplayValue(rejectedB)).toBe('A');
    expect(editRemoteDraft(rejectedB, 'D')).toBe(rejectedB);

    expect(acknowledgeRemoteEditError(rejectedB)).toMatchObject({
      confirmed: 'A',
      draft: 'C',
      phase: 'dirty',
      requestId: 1,
    });
  });

  it('requires acknowledgement before resuming a queued newer request', () => {
    const updatingB = beginRemoteEdit(
      queueRemoteEdit(editRemoteDraft(createRemoteEditState('agent:one', 'A'), 'B'), 3),
      'agent:one',
      3,
    );
    const queuedC = queueRemoteEdit(editRemoteDraft(updatingB, 'C'), 4);
    const rejectedB = rejectRemoteEdit(queuedC, 'agent:one', 3, 'B was rejected');

    expect(rejectedB).toMatchObject({
      confirmed: 'A',
      draft: 'C',
      phase: 'error-reverted',
      requestId: 4,
      error: 'B was rejected',
      queuedRequest: { requestId: 4, submitted: 'C' },
    });
    expect(getRemoteEditDisplayValue(rejectedB)).toBe('A');
    expect(beginRemoteEdit(rejectedB, 'agent:one', 4)).toBe(rejectedB);

    const resumed = acknowledgeRemoteEditError(rejectedB);
    expect(resumed).toMatchObject({
      confirmed: 'A',
      draft: 'C',
      phase: 'queued',
      requestId: 4,
      queuedRequest: { requestId: 4, submitted: 'C' },
    });
    expect(beginRemoteEdit(resumed, 'agent:one', 4)).toMatchObject({ phase: 'updating' });
  });

  it('restores the confirmed value after an authoritative rejection', () => {
    const updating = beginRemoteEdit(
      queueRemoteEdit(editRemoteDraft(createRemoteEditState('agent:one', 'old'), 'new'), 3),
      'agent:one',
      3,
    );

    expect(rejectRemoteEdit(updating, 'agent:one', 3, 'not writable')).toMatchObject({
      scopeKey: 'agent:one',
      confirmed: 'old',
      draft: 'old',
      phase: 'error-reverted',
      requestId: 3,
      error: 'not writable',
    });
  });

  it('shows confirmed data after an ambiguous failure while retaining intent', () => {
    const updating = beginRemoteEdit(
      queueRemoteEdit(editRemoteDraft(createRemoteEditState('agent:one', 'old'), 'intended'), 4),
      'agent:one',
      4,
    );
    const uncertain = markRemoteEditUncertain(updating, 'agent:one', 4, 'request timed out');

    expect(uncertain).toMatchObject({
      scopeKey: 'agent:one',
      confirmed: 'old',
      draft: 'intended',
      phase: 'uncertain',
      requestId: 4,
      error: 'request timed out',
    });
    expect(getRemoteEditDisplayValue(uncertain)).toBe('old');
  });

  it('reconciles an applied uncertain write as success', () => {
    const uncertain = markRemoteEditUncertain(
      beginRemoteEdit(
        queueRemoteEdit(editRemoteDraft(createRemoteEditState('agent:one', 'old'), 'intended'), 5),
        'agent:one',
        5,
      ),
      'agent:one',
      5,
      'request timed out',
    );

    expect(reconcileRemoteEdit(uncertain, 'agent:one', 5, 'intended')).toMatchObject({
      scopeKey: 'agent:one',
      confirmed: 'intended',
      draft: 'intended',
      phase: 'success',
      requestId: 5,
    });
  });

  it('reconciles divergent authority as a conflict without losing intent', () => {
    const intended = { enabled: true, interval: 30 };
    const remote = { enabled: false, interval: 60 };
    const uncertain = markRemoteEditUncertain(
      beginRemoteEdit(
        queueRemoteEdit(
          editRemoteDraft(
            createRemoteEditState('agent:one', { enabled: false, interval: 15 }),
            intended,
          ),
          6,
        ),
        'agent:one',
        6,
      ),
      'agent:one',
      6,
      'connection reset',
    );

    expect(reconcileRemoteEdit(uncertain, 'agent:one', 6, remote)).toMatchObject({
      scopeKey: 'agent:one',
      confirmed: remote,
      draft: intended,
      remote,
      phase: 'conflict',
      requestId: 6,
      error: 'connection reset',
    });
  });

  it('uses semantic equality for separately allocated record values', () => {
    const submitted = { enabled: true, nested: { interval: 30 }, labels: ['a', 'b'] };
    const uncertain = markRemoteEditUncertain(
      beginRemoteEdit(
        queueRemoteEdit(
          editRemoteDraft(createRemoteEditState('agent:one', { enabled: false }), submitted),
          8,
        ),
        'agent:one',
        8,
      ),
      'agent:one',
      8,
      'timeout',
    );

    const equivalent = { enabled: true, nested: { interval: 30 }, labels: ['a', 'b'] };
    expect(reconcileRemoteEdit(uncertain, 'agent:one', 8, equivalent)).toMatchObject({
      confirmed: equivalent,
      draft: equivalent,
      phase: 'success',
    });
  });

  it('rejects illegal, stale, and non-monotonic transitions by identity', () => {
    const dirty = editRemoteDraft(createRemoteEditState('agent:one', 'A'), 'B');
    expect(beginRemoteEdit(dirty, 'agent:one', 1)).toBe(dirty);

    const queued = queueRemoteEdit(dirty, 4);
    expect(queueRemoteEdit(queued, 5)).toBe(queued);
    expect(queueRemoteEdit(queued, 4)).toBe(queued);
    expect(queueRemoteEdit(queued, 3)).toBe(queued);
    expect(beginRemoteEdit(queued, 'agent:one', 3)).toBe(queued);

    const updating = beginRemoteEdit(queued, 'agent:one', 4);
    expect(reconcileRemoteEdit(updating, 'agent:one', 4, 'B')).toBe(updating);
    const uncertain = markRemoteEditUncertain(updating, 'agent:one', 4, 'timeout');
    expect(markRemoteEditUncertain(uncertain, 'agent:one', 4, 'again')).toBe(uncertain);
    expect(succeedRemoteEdit(uncertain, 'agent:one', 4, 'B')).toBe(uncertain);
    expect(rejectRemoteEdit(uncertain, 'agent:one', 4, 'late rejection')).toBe(uncertain);
    expect(reconcileRemoteEdit(uncertain, 'agent:one', 3, 'B')).toBe(uncertain);
    expect(reconcileRemoteEdit(uncertain, 'agent:other', 4, 'B')).toBe(uncertain);
  });

  it('does not treat distinct unsupported object instances as equal', () => {
    expect(structuralRemoteEditEquality(new Map([['key', 1]]), new Map([['key', 1]]))).toBe(false);
    expect(structuralRemoteEditEquality(new Set(['value']), new Set(['value']))).toBe(false);
    expect(structuralRemoteEditEquality(/value/i, /value/i)).toBe(false);
    expect(
      structuralRemoteEditEquality(new URL('https://example.com'), new URL('https://example.com')),
    ).toBe(false);
  });

  it('compares cyclic plain records without overflowing', () => {
    const left: { label: string; self?: unknown } = { label: 'same' };
    const right: { label: string; self?: unknown } = { label: 'same' };
    left.self = left;
    right.self = right;
    expect(structuralRemoteEditEquality(left, right)).toBe(true);

    const different: { label: string; self?: unknown } = { label: 'different' };
    different.self = different;
    expect(structuralRemoteEditEquality(left, different)).toBe(false);
  });
});
