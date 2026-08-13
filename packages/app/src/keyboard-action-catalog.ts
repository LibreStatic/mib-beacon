import { assertActionExposureInvariants, type AppAction } from './action-registry';
import type { Tab } from './store';

/**
 * Product-owned inventory of interactions that are faster, more precise, or
 * commonly repeated with a keyboard. Contextual owners must always register
 * every action in their slice, using a disabled reason when the interaction is
 * not currently available. This makes omission detectable instead of merely
 * checking the subset that happened to be registered.
 */
export const KEYBOARD_ACTION_IDS = {
  browse: [
    'browse:clear-module-focus',
    'browse:refresh',
    'browse:open-selected-live',
    'browse:show-console',
    'browse:hide-console',
  ],
  tools: [
    'tools:show-graphs',
    'tools:show-watches',
    'tools:show-discovery',
    'tools:show-compare',
    'tools:show-ports',
    'tools:show-reachability',
    'tools:start-pattern',
    'tools:stop-pattern',
    'tools:sample-now',
    'tools:save-chart',
    'tools:start-discovery',
    'tools:start-compare',
    'tools:start-ports',
    'tools:start-reachability',
    'tools:cancel-discovery',
    'tools:cancel-compare',
    'tools:cancel-ports',
    'tools:cancel-reachability',
  ],
  traps: [
    'traps:toggle-receiver',
    'traps:apply-filter',
    'traps:reset-filter',
    'traps:export-csv',
    'traps:export-json',
    'traps:compose',
    'traps:refresh',
    'traps:clear-capture',
  ],
  packets: [
    'packets:toggle-console',
    'packets:toggle-pause',
    'packets:clear',
    'packets:export-pcapng',
  ],
  agents: [
    'agents:refresh',
    'agents:new-profile',
    'agents:show-profiles',
    'agents:show-groups',
    'agents:reconcile',
    'agents:retry',
    'agents:acknowledge',
  ],
  liveMibs: [
    'live-mibs:create-profile',
    'live-mibs:focus-search',
    'live-mibs:refresh',
    'live-mibs:stop-scan',
    'live-mibs:resume-auto-refresh',
  ],
  settings: [
    'settings:show-appearance',
    'settings:show-live-mibs',
    'settings:show-updates',
    'settings:show-notifications',
    'settings:show-layout',
    'settings:show-privacy',
    'settings:show-cache',
    'settings:show-sources',
    'settings:show-transfer',
    'settings:show-activity',
    'settings:show-about',
    'settings:request-notification-permission',
    'settings:send-test-notification',
    'settings:reset-split-layout',
    'settings:reset-packet-dock',
    'settings:open-packet-console',
    'settings:check-update',
    'settings:save-live-mibs',
    'settings:cancel-live-mibs',
    'settings:retry-live-mibs',
    'settings:reconcile-live-mibs',
    'settings:acknowledge-live-mibs',
    'settings:save-update-preference',
    'settings:cancel-update-preference',
    'settings:retry-update-preference',
    'settings:reconcile-update-preference',
    'settings:acknowledge-update-preference',
    'settings:save-resolver',
    'settings:cancel-resolver',
    'settings:retry-resolver',
    'settings:reconcile-resolver',
    'settings:acknowledge-resolver',
    'settings:save-packet-retention',
    'settings:cancel-packet-retention',
    'settings:retry-packet-retention',
    'settings:reconcile-packet-retention',
    'settings:acknowledge-packet-retention',
  ],
} as const;

export type KeyboardActionOwner = keyof typeof KEYBOARD_ACTION_IDS;
export type CatalogKeyboardActionId = (typeof KEYBOARD_ACTION_IDS)[KeyboardActionOwner][number];

const CATALOG_OWNER_ROUTES: Record<KeyboardActionOwner, Tab> = {
  browse: 'browse',
  tools: 'tools',
  traps: 'traps',
  packets: 'browse',
  agents: 'agents',
  liveMibs: 'liveMibs',
  settings: 'settings',
};

export interface CatalogActionOptions {
  readonly enabled?: AppAction['enabled'];
  readonly confirmation?: AppAction['confirmation'];
  readonly glyph?: string;
  readonly keywords?: readonly string[];
  readonly platforms?: AppAction['platforms'];
}

export function keyboardAction(
  id: CatalogKeyboardActionId,
  label: string,
  group: string,
  execute: AppAction['execute'],
  options: CatalogActionOptions = {},
): AppAction {
  return {
    id,
    label,
    group,
    glyph: options.glyph ?? '›',
    keywords: options.keywords ?? [
      group.toLowerCase(),
      label.toLowerCase(),
      humanizeCatalogId(id),
      id,
    ],
    keyboard: { suitable: true },
    palette: { exposed: true },
    enabled: options.enabled ?? { value: true },
    confirmation: options.confirmation ?? { kind: 'none' },
    platforms: options.platforms ?? ['web', 'desktop', 'native'],
    execute,
  };
}

/**
 * Keeps route-owned commands discoverable while their screen is unmounted.
 * Selecting a fallback opens the owning route and deliberately keeps the
 * palette open; the screen's higher-priority registration then supplies the
 * real state, confirmation, and execution handler for a second selection.
 */
export function catalogFallbackActions(navigate: (route: Tab) => void): AppAction[] {
  return KEYBOARD_ACTION_CATALOG.map(({ id, owner }) =>
    keyboardAction(
      id,
      `Open ${owner === 'liveMibs' ? 'Live MIBs' : owner} for ${humanizeCatalogId(id)}`,
      'Navigation',
      () => {
        navigate(CATALOG_OWNER_ROUTES[owner]);
        return false;
      },
      { keywords: [owner, humanizeCatalogId(id), 'open', 'navigate'] },
    ),
  );
}

function humanizeCatalogId(id: string): string {
  return id.slice(id.indexOf(':') + 1).replaceAll('-', ' ');
}

export const KEYBOARD_ACTION_CATALOG = Object.entries(KEYBOARD_ACTION_IDS).flatMap(([owner, ids]) =>
  ids.map((id) => ({
    id,
    owner: owner as KeyboardActionOwner,
    keyboardSuitable: true as const,
    paletteRequired: true as const,
  })),
);

export function assertGlobalActionIdNamespace(
  inventories: Readonly<Record<string, readonly string[]>>,
): void {
  const owners = new Map<string, string>();
  for (const [inventory, ids] of Object.entries(inventories)) {
    for (const id of ids) {
      const existing = owners.get(id);
      if (existing)
        throw new Error(`Duplicate global action ID ${id}: ${existing} and ${inventory}`);
      owners.set(id, inventory);
    }
  }
}

export type ContextualActionOwner = KeyboardActionOwner;

export interface ContextualActionClassification {
  id: string;
  owner: ContextualActionOwner;
  label: string;
  classification: 'contextual-only';
  rationale: string;
}

const contextual = (
  owner: ContextualActionOwner,
  id: string,
  label: string,
  rationale: string,
): ContextualActionClassification => ({
  id,
  owner,
  label,
  classification: 'contextual-only',
  rationale,
});

/**
 * Explicit audit classification for controls intentionally excluded from the global palette.
 * Exclusions are limited to transient/dynamic item context or draft-bound transaction recovery;
 * the controls remain keyboard reachable in their owning screen.
 */
export const CONTEXTUAL_ACTION_CLASSIFICATIONS = [
  contextual(
    'browse',
    'browse:selected:get',
    'Get selected object',
    'The global Query Get command is the keyboard path. This pointer variant first binds the transient selected tree object and would be ambiguous without an object picker.',
  ),
  contextual(
    'browse',
    'browse:selected:get-next',
    'Get Next from selected object',
    'The global Query Get Next command is the keyboard path; this variant depends on the transient selected tree row.',
  ),
  contextual(
    'browse',
    'browse:selected:walk',
    'Walk selected subtree',
    'The global Query Walk command is the keyboard path; this variant depends on the transient selected tree row.',
  ),
  contextual(
    'browse',
    'browse:selected:set',
    'Prepare Set for selected object',
    'The global Query Stage Set command is the keyboard path; this variant binds the selected writable object and its type metadata.',
  ),
  contextual(
    'browse',
    'browse:selected:trap',
    'Send selected notification',
    'This binds a transient notification node and must enter the contextual composer with that exact OID.',
  ),
  contextual(
    'browse',
    'browse:tree-row',
    'Expand, select, inspect, or share a tree row',
    'A dynamic row identity is required; tree controls are keyboard navigable in-place.',
  ),

  contextual(
    'tools',
    'tools:export-series',
    'Export one poll series',
    'Requires choosing one dynamic series and a host-specific binary/text destination.',
  ),
  contextual(
    'tools',
    'tools:item-management',
    'Pause, change, monitor, or delete a tool item',
    'Requires a dynamic series, watch, chart, session, discovery result, or port identity. Item controls remain keyboard reachable.',
  ),

  contextual(
    'traps',
    'traps:record-replay',
    'Replay a captured trap',
    'Requires one dynamic captured record and opens the composer prefilled from that record.',
  ),
  contextual(
    'traps',
    'traps:record-send-again',
    'Send a history item again',
    'Requires one dynamic history request containing its original target and payload.',
  ),
  contextual(
    'traps',
    'traps:record-read-delete-share',
    'Mark, delete, or share a trap record',
    'Requires one dynamic record identity; row actions remain keyboard reachable and preserve per-record pending guards.',
  ),
  contextual(
    'traps',
    'traps:saved-item',
    'Apply, edit, or delete saved Trap data',
    'Requires one dynamic saved filter, credential, rule, or preset identity.',
  ),

  contextual(
    'agents',
    'agents:profile-edit',
    'Edit agent profile',
    'Requires choosing a dynamic credential-bearing profile and hydrating its redacted draft.',
  ),
  contextual(
    'agents',
    'agents:profile-test',
    'Test agent profile',
    'Requires one dynamic profile identity and displays the result beside that profile.',
  ),
  contextual(
    'agents',
    'agents:profile-delete',
    'Delete agent profile',
    'Requires one dynamic profile identity and an item-specific destructive confirmation.',
  ),
  contextual(
    'agents',
    'agents:create-group',
    'Create agent group',
    'Submits the visible name and dynamic member-selection draft; the form button is keyboard reachable.',
  ),
  contextual(
    'agents',
    'agents:group-edit-delete',
    'Edit or delete agent group',
    'Requires a dynamic group and its membership draft.',
  ),

  contextual(
    'liveMibs',
    'live-mibs:cell-apply',
    'Apply Live MIB cell Set',
    'A per-cell remote transaction binds OID, wire type, draft, request sequence, and confirmation state.',
  ),
  contextual(
    'liveMibs',
    'live-mibs:cell-use-device',
    'Use device value',
    'Only meaningful for the currently conflicted cell and its confirmed remote value.',
  ),
  contextual(
    'liveMibs',
    'live-mibs:cell-reapply',
    'Reapply cell draft',
    'Only meaningful for one conflicted cell and must reuse that cell transaction request guard.',
  ),
  contextual(
    'liveMibs',
    'live-mibs:binary-import',
    'Choose binary and start workflow',
    'Requires a platform file picker plus the current cell and workflow-adapter draft.',
  ),
  contextual(
    'liveMibs',
    'live-mibs:scope-agent',
    'Choose agent or MIB scope',
    'Requires a dynamic agent or tree-node identity and is keyboard navigable in-place.',
  ),

  contextual(
    'settings',
    'settings:source-management',
    'Create, edit, test, reorder, enable, or delete source',
    'Requires a dynamic source identity or credential-bearing editor draft.',
  ),
  contextual(
    'settings',
    'settings:configuration-import-export',
    'Import or export resolver configuration',
    'Import submits the visible text draft; export uses a platform share target. Both remain keyboard reachable in context.',
  ),
  contextual(
    'settings',
    'settings:update-download-install',
    'Download or install update',
    'Availability is tied to the current host update status and installation carries a host restart disclosure in context.',
  ),
  contextual(
    'settings',
    'settings:theme-item',
    'Select or remove a specific theme',
    'Requires a dynamic installed/bundled theme identity; the theme picker and Settings chips are keyboard navigable.',
  ),
] as const satisfies readonly ContextualActionClassification[];

export function assertContextualActionClassifications(
  classifications: readonly ContextualActionClassification[] = CONTEXTUAL_ACTION_CLASSIFICATIONS,
): void {
  const ids = new Set<string>();
  for (const entry of classifications) {
    if (ids.has(entry.id)) throw new Error(`Duplicate contextual action id: ${entry.id}`);
    ids.add(entry.id);
    if (!entry.label.trim()) throw new Error(`Missing contextual action label: ${entry.id}`);
    if (!entry.rationale.trim())
      throw new Error(`Missing contextual action rationale: ${entry.id}`);
    if (entry.classification !== 'contextual-only') {
      throw new Error(`Invalid contextual action classification: ${entry.id}`);
    }
  }
}

export function assertCatalogOwnerActions(
  owner: KeyboardActionOwner,
  actions: readonly AppAction[],
): void {
  const expected = new Set<string>(KEYBOARD_ACTION_IDS[owner]);
  const actual = new Set(actions.map(({ id }) => id));
  const missing = [...expected].filter((id) => !actual.has(id));
  const unexpected = [...actual].filter((id) => !expected.has(id));
  if (missing.length || unexpected.length) {
    throw new Error(
      `Keyboard action catalog mismatch for ${owner}: missing [${missing.join(', ')}], unexpected [${unexpected.join(', ')}]`,
    );
  }
  assertActionExposureInvariants(actions, []);
}

export function catalogActions<T extends readonly AppAction[]>(
  owner: KeyboardActionOwner,
  actions: T,
): T {
  assertCatalogOwnerActions(owner, actions);
  return actions;
}
