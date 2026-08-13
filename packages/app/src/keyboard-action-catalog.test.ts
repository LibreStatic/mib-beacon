import { describe, expect, it, vi } from 'vitest';
import type { AppAction } from './action-registry';
import {
  CONTEXTUAL_ACTION_CLASSIFICATIONS,
  KEYBOARD_ACTION_CATALOG,
  KEYBOARD_ACTION_IDS,
  assertCatalogOwnerActions,
  assertContextualActionClassifications,
  assertGlobalActionIdNamespace,
  catalogFallbackActions,
  keyboardAction,
} from './keyboard-action-catalog';
import { STATIC_PALETTE_COMMANDS } from './command-palette';
import { QUERY_ACTION_IDS } from './query-actions';

const EXPECTED_CONTEXTUAL_ACTIONS = [
  [
    'browse:selected:get',
    'The global Query Get command is the keyboard path. This pointer variant first binds the transient selected tree object and would be ambiguous without an object picker.',
  ],
  [
    'browse:selected:get-next',
    'The global Query Get Next command is the keyboard path; this variant depends on the transient selected tree row.',
  ],
  [
    'browse:selected:walk',
    'The global Query Walk command is the keyboard path; this variant depends on the transient selected tree row.',
  ],
  [
    'browse:selected:set',
    'The global Query Stage Set command is the keyboard path; this variant binds the selected writable object and its type metadata.',
  ],
  [
    'browse:selected:trap',
    'This binds a transient notification node and must enter the contextual composer with that exact OID.',
  ],
  [
    'browse:tree-row',
    'A dynamic row identity is required; tree controls are keyboard navigable in-place.',
  ],
  [
    'tools:export-series',
    'Requires choosing one dynamic series and a host-specific binary/text destination.',
  ],
  [
    'tools:item-management',
    'Requires a dynamic series, watch, chart, session, discovery result, or port identity. Item controls remain keyboard reachable.',
  ],
  [
    'traps:record-replay',
    'Requires one dynamic captured record and opens the composer prefilled from that record.',
  ],
  [
    'traps:record-send-again',
    'Requires one dynamic history request containing its original target and payload.',
  ],
  [
    'traps:record-read-delete-share',
    'Requires one dynamic record identity; row actions remain keyboard reachable and preserve per-record pending guards.',
  ],
  ['traps:saved-item', 'Requires one dynamic saved filter, credential, rule, or preset identity.'],
  [
    'agents:profile-edit',
    'Requires choosing a dynamic credential-bearing profile and hydrating its redacted draft.',
  ],
  [
    'agents:profile-test',
    'Requires one dynamic profile identity and displays the result beside that profile.',
  ],
  [
    'agents:profile-delete',
    'Requires one dynamic profile identity and an item-specific destructive confirmation.',
  ],
  [
    'agents:create-group',
    'Submits the visible name and dynamic member-selection draft; the form button is keyboard reachable.',
  ],
  ['agents:group-edit-delete', 'Requires a dynamic group and its membership draft.'],
  [
    'live-mibs:cell-apply',
    'A per-cell remote transaction binds OID, wire type, draft, request sequence, and confirmation state.',
  ],
  [
    'live-mibs:cell-use-device',
    'Only meaningful for the currently conflicted cell and its confirmed remote value.',
  ],
  [
    'live-mibs:cell-reapply',
    'Only meaningful for one conflicted cell and must reuse that cell transaction request guard.',
  ],
  [
    'live-mibs:binary-import',
    'Requires a platform file picker plus the current cell and workflow-adapter draft.',
  ],
  [
    'live-mibs:scope-agent',
    'Requires a dynamic agent or tree-node identity and is keyboard navigable in-place.',
  ],
  [
    'settings:source-management',
    'Requires a dynamic source identity or credential-bearing editor draft.',
  ],
  [
    'settings:configuration-import-export',
    'Import submits the visible text draft; export uses a platform share target. Both remain keyboard reachable in context.',
  ],
  [
    'settings:update-download-install',
    'Availability is tied to the current host update status and installation carries a host restart disclosure in context.',
  ],
  [
    'settings:theme-item',
    'Requires a dynamic installed/bundled theme identity; the theme picker and Settings chips are keyboard navigable.',
  ],
] as const;

describe('keyboard action catalog', () => {
  it('owns unique, stable action IDs across every required product surface', () => {
    const ids = KEYBOARD_ACTION_CATALOG.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(KEYBOARD_ACTION_IDS)).toEqual([
      'browse',
      'tools',
      'traps',
      'packets',
      'agents',
      'liveMibs',
      'settings',
    ]);
    expect(KEYBOARD_ACTION_CATALOG.every(({ keyboardSuitable }) => keyboardSuitable)).toBe(true);
    expect(KEYBOARD_ACTION_CATALOG.every(({ paletteRequired }) => paletteRequired)).toBe(true);
  });

  it('enforces one global namespace across static, Query, resolver, and catalog actions', () => {
    const inventories = {
      static: STATIC_PALETTE_COMMANDS.map(({ id }) => id),
      query: QUERY_ACTION_IDS,
      resolverCache: ['settings:clear-resolver-cache'],
      catalog: KEYBOARD_ACTION_CATALOG.map(({ id }) => id),
    };
    expect(() => assertGlobalActionIdNamespace(inventories)).not.toThrow();
    expect(() =>
      assertGlobalActionIdNamespace({ ...inventories, collision: [QUERY_ACTION_IDS[0]!] }),
    ).toThrow(/duplicate global action id/i);
  });

  it('fails when an owner omits or invents a keyboard-suitable action', () => {
    const actions = KEYBOARD_ACTION_IDS.packets.map((id) =>
      keyboardAction(id, id, 'Packets', vi.fn()),
    );
    expect(() => assertCatalogOwnerActions('packets', actions.slice(1))).toThrow(
      /missing \[packets:toggle-console\]/,
    );
    expect(() =>
      assertCatalogOwnerActions('packets', [
        ...actions,
        { ...actions[0]!, id: 'packets:uncatalogued' } as AppAction,
      ]),
    ).toThrow(/unexpected \[packets:uncatalogued\]/);
  });

  it('requires catalog actions to remain keyboard-suitable and palette-exposed', () => {
    const actions = KEYBOARD_ACTION_IDS.browse.map((id) =>
      keyboardAction(id, id, 'Browse', vi.fn()),
    );
    expect(() => assertCatalogOwnerActions('browse', actions)).not.toThrow();
    expect(() =>
      assertCatalogOwnerActions('browse', [
        { ...actions[0]!, palette: { exposed: false } },
        ...actions.slice(1),
      ]),
    ).toThrow(/keyboard-suitable.*palette-exposed/i);
  });

  it('creates one non-executing navigation fallback for every catalog ID', async () => {
    const navigate = vi.fn();
    const fallbacks = catalogFallbackActions(navigate);
    expect(fallbacks.map(({ id }) => id)).toEqual(KEYBOARD_ACTION_CATALOG.map(({ id }) => id));
    expect(fallbacks.find(({ id }) => id === 'tools:start-ports')?.execute()).toBe(false);
    expect(navigate).toHaveBeenCalledWith('tools');
    expect(fallbacks.find(({ id }) => id === 'packets:clear')?.execute()).toBe(false);
    expect(navigate).toHaveBeenLastCalledWith('browse');
  });

  it('keeps an action searchable by its stable ID after a fallback hands ownership to a route', () => {
    const action = keyboardAction('tools:start-ports', 'Load interface table', 'Tools', vi.fn());
    expect(action.keywords).toContain('start ports');
    expect(action.keywords).toContain('tools:start-ports');
  });
});

describe('contextual-only action classifications', () => {
  it('validates and locks the complete exclusion ID and rationale inventory', () => {
    expect(() => assertContextualActionClassifications()).not.toThrow();
    expect(CONTEXTUAL_ACTION_CLASSIFICATIONS.map(({ id, rationale }) => [id, rationale])).toEqual(
      EXPECTED_CONTEXTUAL_ACTIONS,
    );
  });

  it('rejects duplicate IDs and blank exclusion rationales', () => {
    const first = CONTEXTUAL_ACTION_CLASSIFICATIONS[0]!;
    expect(() =>
      assertContextualActionClassifications([
        ...CONTEXTUAL_ACTION_CLASSIFICATIONS,
        { ...first, id: first.id },
      ]),
    ).toThrow(/duplicate contextual action id/i);
    expect(() => assertContextualActionClassifications([{ ...first, rationale: '   ' }])).toThrow(
      /missing contextual action rationale/i,
    );
  });
});
