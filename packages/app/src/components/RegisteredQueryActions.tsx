import { useMemo } from 'react';
import { validateVarbindInput } from '@mibbeacon/core/client';
import { useRegisteredActions } from '../action-registry-react';
import {
  prepareSetReview,
  resolveOidHint,
  runGet,
  runGetBulk,
  runGetNext,
  runWalk,
  stopWalk,
} from '../actions';
import { useEngine, useEngineOwnership } from '../engine-context';
import { createQueryActions } from '../query-actions';
import { useAppStore } from '../store';

export function RegisteredQueryActions({ navigateToQuery }: { navigateToQuery(): void }) {
  const engine = useEngine();
  const ownsEngine = useEngineOwnership();
  const operation = useAppStore((state) => state.queryOperation);
  const running = useAppStore((state) => Boolean(state.running));
  const setDraft = useAppStore((state) => state.setDraft);
  const setStaging = useAppStore((state) => state.setStaging);
  const setValidationError = (setStaging.length ? setStaging : [setDraft])
    .map(validateVarbindInput)
    .find(Boolean);
  const actions = useMemo(
    () =>
      createQueryActions({
        operation,
        running,
        setValidationError: setValidationError ?? undefined,
        selectOperation: (next) => {
          const state = useAppStore.getState();
          state.setQueryOperation(next);
          if (next === 'set') {
            state.updateSetDraft({ oid: state.oid });
            void resolveOidHint(engine, state.oid, ownsEngine);
          }
        },
        runGet: () => runGet(engine, ownsEngine),
        runGetNext: () => runGetNext(engine, ownsEngine),
        runGetBulk: () => runGetBulk(engine, ownsEngine),
        runWalk: () => runWalk(engine, ownsEngine),
        stageSet: () => prepareSetReview(engine, ownsEngine),
        stop: () => stopWalk(engine, ownsEngine),
        navigateToQuery: () => {
          if (ownsEngine()) navigateToQuery();
        },
      }),
    [engine, navigateToQuery, operation, ownsEngine, running, setValidationError],
  );
  useRegisteredActions(actions);
  return null;
}
