import type {
  ActionEnabledState,
  ActionShortcutBinding,
  AppAction,
} from './action-registry';
import type { QueryShortcut } from './browser-shortcuts';
import type { QueryOperation } from './store';

export type QueryActionId =
  | 'query:prepare-get'
  | 'query:prepare-get-next'
  | 'query:prepare-get-bulk'
  | 'query:prepare-walk'
  | 'query:prepare-set'
  | 'query:get'
  | 'query:get-next'
  | 'query:get-bulk'
  | 'query:walk'
  | 'query:stage-set'
  | 'query:run-current'
  | 'query:repeat'
  | 'query:stop';

export interface QueryActionContext {
  operation: QueryOperation;
  running: boolean;
  setValidationError?: string;
  selectOperation(operation: QueryOperation): void;
  runGet(): void | Promise<void>;
  runGetNext(): void | Promise<void>;
  runGetBulk(): void | Promise<void>;
  runWalk(): void | Promise<void>;
  stageSet(): void | Promise<void>;
  stop(): void | Promise<void>;
  navigateToQuery(): void;
}

export const QUERY_OPERATION_SLUGS = {
  get: 'get',
  getNext: 'get-next',
  getBulk: 'get-bulk',
  walk: 'walk',
  set: 'set',
} as const satisfies Record<QueryOperation, string>;

const SHORTCUT_TO_ACTION = {
  get: 'query:get',
  getNext: 'query:get-next',
  getBulk: 'query:get-bulk',
  walk: 'query:walk',
  set: 'query:stage-set',
  repeat: 'query:repeat',
  stop: 'query:stop',
} as const satisfies Record<QueryShortcut, QueryActionId>;

export const QUERY_SHORTCUT_BINDINGS: readonly ActionShortcutBinding[] = Object.entries(
  SHORTCUT_TO_ACTION,
).map(([shortcutId, actionId]) => ({ shortcutId: `query:${shortcutId}`, actionId }));

export function queryShortcutActionId(shortcut: QueryShortcut): QueryActionId {
  return SHORTCUT_TO_ACTION[shortcut];
}

export function createQueryActions(context: QueryActionContext): AppAction[] {
  const runFor = (operation: QueryOperation) => {
    if (operation === 'get') return context.runGet();
    if (operation === 'getNext') return context.runGetNext();
    if (operation === 'getBulk') return context.runGetBulk();
    if (operation === 'walk') return context.runWalk();
    return context.stageSet();
  };
  const runningState: ActionEnabledState = context.running
    ? { value: false, reason: 'A query operation is already running.' }
    : { value: true };
  const currentState: ActionEnabledState = context.running
    ? runningState
    : context.operation === 'set' && context.setValidationError
      ? { value: false, reason: context.setValidationError }
      : { value: true };
  const definition = (
    id: QueryActionId,
    label: string,
    execute: AppAction['execute'],
    options: {
      enabled?: AppAction['enabled'];
      shortcut?: QueryShortcut;
      confirmation?: AppAction['confirmation'];
      glyph?: string;
    } = {},
  ): AppAction => ({
    id,
    label,
    group: 'Query',
    glyph: options.glyph ?? '⇄',
    keywords: ['query', 'snmp', label.toLowerCase()],
    keyboard: {
      suitable: true,
      ...(options.shortcut ? { shortcutIds: [`query:${options.shortcut}`] } : {}),
    },
    palette: { exposed: true },
    enabled: options.enabled ?? runningState,
    confirmation: options.confirmation ?? { kind: 'none' },
    platforms: ['web', 'desktop', 'native'],
    execute,
  });
  const direct = (
    id: QueryActionId,
    label: string,
    operation: QueryOperation,
    shortcut: QueryShortcut,
  ) =>
    definition(
      id,
      label,
      () => {
        context.navigateToQuery();
        context.selectOperation(operation);
        return runFor(operation);
      },
      {
        shortcut,
        enabled:
          operation === 'set' && context.setValidationError
            ? { value: false, reason: context.setValidationError }
            : runningState,
        confirmation: { kind: 'none' },
      },
    );

  const prepare = (id: QueryActionId, label: string, operation: QueryOperation) =>
    definition(
      id,
      label,
      () => {
        context.selectOperation(operation);
        context.navigateToQuery();
      },
      { enabled: { value: true } },
    );

  return [
    prepare('query:prepare-get', 'Prepare Get', 'get'),
    prepare('query:prepare-get-next', 'Prepare Get Next', 'getNext'),
    prepare('query:prepare-get-bulk', 'Prepare Get Bulk', 'getBulk'),
    prepare('query:prepare-walk', 'Prepare Walk', 'walk'),
    prepare('query:prepare-set', 'Prepare Set', 'set'),
    direct('query:get', 'Get', 'get', 'get'),
    direct('query:get-next', 'Get Next', 'getNext', 'getNext'),
    direct('query:get-bulk', 'Get Bulk', 'getBulk', 'getBulk'),
    direct('query:walk', 'Walk', 'walk', 'walk'),
    direct('query:stage-set', 'Stage Set request', 'set', 'set'),
    definition(
      'query:run-current',
      'Run current query',
      () => {
        context.navigateToQuery();
        return runFor(context.operation);
      },
      { enabled: currentState, glyph: '▶' },
    ),
    definition(
      'query:repeat',
      'Repeat selected query operation',
      () => {
        context.navigateToQuery();
        return runFor(context.operation);
      },
      { enabled: currentState, shortcut: 'repeat', glyph: '↻' },
    ),
    definition('query:stop', 'Stop active query operation', context.stop, {
      enabled: context.running
        ? { value: true }
        : { value: false, reason: 'No query operation is running.' },
      shortcut: 'stop',
      glyph: '■',
    }),
  ];
}
