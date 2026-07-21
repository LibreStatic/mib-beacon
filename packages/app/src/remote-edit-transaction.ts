export type RemoteEditPhase =
  | 'confirmed'
  | 'dirty'
  | 'queued'
  | 'updating'
  | 'success'
  | 'error-reverted'
  | 'uncertain'
  | 'conflict';

export type RemoteEditEquality<T> = (left: T, right: T) => boolean;

export interface RemoteEditRequest<T> {
  readonly requestId: number;
  readonly submitted: T;
}

interface RemoteEditBase<T> {
  readonly scopeKey: string;
  readonly confirmed: T;
  readonly draft: T;
  /** Highest request identifier allocated in this scope. */
  readonly requestId: number;
  readonly equals: RemoteEditEquality<T>;
}

export type RemoteEditState<T> =
  | (RemoteEditBase<T> & {
      readonly phase: 'confirmed' | 'success';
      readonly activeRequest?: never;
      readonly queuedRequest?: never;
      readonly error?: never;
      readonly remote?: never;
    })
  | (RemoteEditBase<T> & {
      readonly phase: 'dirty';
      readonly activeRequest?: RemoteEditRequest<T>;
      readonly queuedRequest?: RemoteEditRequest<T>;
      readonly error?: never;
      readonly remote?: never;
    })
  | (RemoteEditBase<T> & {
      readonly phase: 'queued';
      readonly queuedRequest: RemoteEditRequest<T>;
      readonly activeRequest?: RemoteEditRequest<T>;
      readonly error?: never;
      readonly remote?: never;
    })
  | (RemoteEditBase<T> & {
      readonly phase: 'updating';
      readonly activeRequest: RemoteEditRequest<T>;
      readonly queuedRequest?: never;
      readonly error?: never;
      readonly remote?: never;
    })
  | (RemoteEditBase<T> & {
      readonly phase: 'error-reverted';
      readonly error: string;
      readonly activeRequest?: never;
      readonly queuedRequest?: RemoteEditRequest<T>;
      readonly remote?: never;
    })
  | (RemoteEditBase<T> & {
      readonly phase: 'uncertain';
      readonly error: string;
      readonly activeRequest: RemoteEditRequest<T>;
      readonly queuedRequest?: RemoteEditRequest<T>;
      readonly remote?: never;
    })
  | (RemoteEditBase<T> & {
      readonly phase: 'conflict';
      readonly error: string;
      readonly remote: T;
      readonly activeRequest?: never;
      readonly queuedRequest?: never;
    });

export function createRemoteEditState<T>(
  scopeKey: string,
  confirmed: T,
  equals: RemoteEditEquality<T> = structuralRemoteEditEquality,
): RemoteEditState<T> {
  return {
    scopeKey,
    confirmed,
    draft: confirmed,
    phase: 'confirmed',
    requestId: 0,
    equals,
  };
}

export function editRemoteDraft<T>(state: RemoteEditState<T>, draft: T): RemoteEditState<T> {
  if (state.phase === 'uncertain' || state.phase === 'error-reverted') return state;
  return {
    ...base(state, state.confirmed, draft),
    phase: 'dirty',
    ...pendingRequests(state),
  };
}

export function queueRemoteEdit<T>(
  state: RemoteEditState<T>,
  requestId: number,
): RemoteEditState<T> {
  if (state.phase !== 'dirty' || state.queuedRequest || requestId <= state.requestId) return state;
  return {
    ...base(state, state.confirmed, state.draft, requestId),
    phase: 'queued',
    activeRequest: state.activeRequest,
    queuedRequest: { requestId, submitted: state.draft },
  };
}

export function beginRemoteEdit<T>(
  state: RemoteEditState<T>,
  scopeKey: string,
  requestId: number,
): RemoteEditState<T> {
  if (
    (state.phase !== 'queued' && state.phase !== 'dirty') ||
    state.scopeKey !== scopeKey ||
    state.activeRequest ||
    !state.queuedRequest ||
    state.queuedRequest.requestId !== requestId
  )
    return state;

  const activeRequest = state.queuedRequest;
  if (!state.equals(state.draft, activeRequest.submitted)) {
    return {
      ...base(state, state.confirmed, state.draft),
      phase: 'dirty',
      activeRequest,
    };
  }
  return {
    ...base(state, state.confirmed, state.draft),
    phase: 'updating',
    activeRequest,
  };
}

export function succeedRemoteEdit<T>(
  state: RemoteEditState<T>,
  scopeKey: string,
  requestId: number,
  confirmed: T,
): RemoteEditState<T> {
  if (!hasCurrentActiveRequest(state, scopeKey, requestId)) return state;

  if (state.queuedRequest) {
    return {
      ...base(state, confirmed, state.draft),
      phase: 'queued',
      queuedRequest: state.queuedRequest,
    };
  }
  if (!state.equals(state.draft, state.activeRequest.submitted)) {
    return {
      ...base(state, confirmed, state.draft),
      phase: 'dirty',
    };
  }
  return {
    ...base(state, confirmed, confirmed),
    phase: 'success',
  };
}

export function rejectRemoteEdit<T>(
  state: RemoteEditState<T>,
  scopeKey: string,
  requestId: number,
  error: string,
): RemoteEditState<T> {
  if (!hasCurrentActiveRequest(state, scopeKey, requestId)) return state;

  if (state.queuedRequest || !state.equals(state.draft, state.activeRequest.submitted)) {
    return {
      ...base(state, state.confirmed, state.draft),
      phase: 'error-reverted',
      error,
      queuedRequest: state.queuedRequest,
    };
  }
  return {
    ...base(state, state.confirmed, state.confirmed),
    phase: 'error-reverted',
    error,
  };
}

export function markRemoteEditUncertain<T>(
  state: RemoteEditState<T>,
  scopeKey: string,
  requestId: number,
  error: string,
): RemoteEditState<T> {
  if (!hasCurrentActiveRequest(state, scopeKey, requestId)) return state;
  return {
    ...base(state, state.confirmed, state.draft),
    phase: 'uncertain',
    activeRequest: state.activeRequest,
    queuedRequest: state.queuedRequest,
    error,
  };
}

export function reconcileRemoteEdit<T>(
  state: RemoteEditState<T>,
  scopeKey: string,
  requestId: number,
  remote: T,
): RemoteEditState<T> {
  if (
    state.phase !== 'uncertain' ||
    state.scopeKey !== scopeKey ||
    state.activeRequest.requestId !== requestId
  )
    return state;

  if (!state.equals(remote, state.activeRequest.submitted)) {
    return {
      ...base(state, remote, state.draft),
      phase: 'conflict',
      remote,
      error: state.error,
    };
  }
  if (state.queuedRequest) {
    return {
      ...base(state, remote, state.draft),
      phase: 'queued',
      queuedRequest: state.queuedRequest,
    };
  }
  if (!state.equals(state.draft, state.activeRequest.submitted)) {
    return {
      ...base(state, remote, state.draft),
      phase: 'dirty',
    };
  }
  return {
    ...base(state, remote, remote),
    phase: 'success',
  };
}

export function getRemoteEditDisplayValue<T>(state: RemoteEditState<T>): T {
  return state.phase === 'uncertain' || state.phase === 'error-reverted'
    ? state.confirmed
    : state.draft;
}

export function canCancelRemoteEdit<T>(state: RemoteEditState<T>): boolean {
  if (state.activeRequest || state.queuedRequest) return false;
  return state.phase === 'dirty' || state.phase === 'error-reverted' || state.phase === 'conflict';
}

export function acknowledgeRemoteEditError<T>(state: RemoteEditState<T>): RemoteEditState<T> {
  if (state.phase !== 'error-reverted') return state;
  if (state.queuedRequest) {
    return {
      ...base(state, state.confirmed, state.draft),
      phase: 'queued',
      queuedRequest: state.queuedRequest,
    };
  }
  if (!state.equals(state.draft, state.confirmed)) {
    return {
      ...base(state, state.confirmed, state.draft),
      phase: 'dirty',
    };
  }
  return {
    ...base(state, state.confirmed, state.confirmed),
    phase: 'confirmed',
  };
}

export function structuralRemoteEditEquality<T>(left: T, right: T): boolean {
  return structuralEqual(left, right, new WeakMap<object, WeakSet<object>>());
}

function structuralEqual(
  left: unknown,
  right: unknown,
  seen: WeakMap<object, WeakSet<object>>,
): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object')
    return false;
  const priorRights = seen.get(left);
  if (priorRights?.has(right)) return true;
  if (priorRights) priorRights.add(right);
  else seen.set(left, new WeakSet([right]));
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => structuralEqual(value, right[index], seen))
    );
  }
  if (left instanceof Date || right instanceof Date) {
    return left instanceof Date && right instanceof Date && left.getTime() === right.getTime();
  }
  const leftPrototype = Object.getPrototypeOf(left);
  const rightPrototype = Object.getPrototypeOf(right);
  const leftIsPlain = leftPrototype === Object.prototype || leftPrototype === null;
  const rightIsPlain = rightPrototype === Object.prototype || rightPrototype === null;
  if (!leftIsPlain || !rightIsPlain || leftPrototype !== rightPrototype) return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(rightRecord, key) &&
        structuralEqual(leftRecord[key], rightRecord[key], seen),
    )
  );
}

function base<T>(
  state: RemoteEditState<T>,
  confirmed: T,
  draft: T,
  requestId = state.requestId,
): RemoteEditBase<T> {
  return { scopeKey: state.scopeKey, confirmed, draft, requestId, equals: state.equals };
}

function pendingRequests<T>(state: RemoteEditState<T>): {
  activeRequest?: RemoteEditRequest<T>;
  queuedRequest?: RemoteEditRequest<T>;
} {
  return {
    activeRequest: state.activeRequest,
    queuedRequest: state.queuedRequest,
  };
}

function hasCurrentActiveRequest<T>(
  state: RemoteEditState<T>,
  scopeKey: string,
  requestId: number,
): state is RemoteEditState<T> & { readonly activeRequest: RemoteEditRequest<T> } {
  return (
    state.phase !== 'uncertain' &&
    state.scopeKey === scopeKey &&
    state.activeRequest?.requestId === requestId
  );
}
