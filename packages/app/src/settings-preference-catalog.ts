export type PreferenceClassification = 'settings-backed' | 'contextual-only' | 'constrained';

export interface PreferenceCatalogEntry {
  id: string;
  label: string;
  classification: PreferenceClassification;
  owner:
    'appearance' | 'notifications' | 'layout' | 'activity' | 'resolver' | 'live-mibs' | 'tools';
  rationale: string;
  settingsSection?: string;
}

export const PREFERENCE_CATALOG = [
  {
    id: 'appearance.theme-mode',
    label: 'Color mode and theme selection',
    classification: 'settings-backed',
    owner: 'appearance',
    settingsSection: 'appearance',
    rationale: 'Persistent visual preference used across every workspace.',
  },
  {
    id: 'appearance.density',
    label: 'Interface density',
    classification: 'settings-backed',
    owner: 'appearance',
    settingsSection: 'appearance',
    rationale: 'Persistent touch/compact layout preference with app-wide impact.',
  },
  {
    id: 'notifications.trap-rules',
    label: 'Trap rule notifications',
    classification: 'settings-backed',
    owner: 'notifications',
    settingsSection: 'notifications',
    rationale: 'Requires explicit user opt-in and platform permission visibility.',
  },
  {
    id: 'notifications.watch-alerts',
    label: 'Watch alert notifications',
    classification: 'settings-backed',
    owner: 'notifications',
    settingsSection: 'notifications',
    rationale: 'Requires explicit user opt-in and platform permission visibility.',
  },
  {
    id: 'layout.split-panes',
    label: 'Split pane ratios',
    classification: 'settings-backed',
    owner: 'layout',
    settingsSection: 'layout',
    rationale: 'Persistent layout state must expose a user reset path.',
  },
  {
    id: 'layout.packet-dock',
    label: 'Packet dock size',
    classification: 'settings-backed',
    owner: 'layout',
    settingsSection: 'layout',
    rationale: 'Persistent dock sizing must expose a user reset path.',
  },
  {
    id: 'activity.packet-retention',
    label: 'Packet capture disk retention',
    classification: 'settings-backed',
    owner: 'activity',
    settingsSection: 'activity',
    rationale: 'Persistent disk usage and privacy behavior needs Settings control.',
  },
  {
    id: 'resolver.external-sources',
    label: 'Resolver external source priority',
    classification: 'settings-backed',
    owner: 'resolver',
    settingsSection: 'sources',
    rationale: 'Controls network access, credentials, and dependency-resolution ordering.',
  },
  {
    id: 'live-mibs.refresh-policy',
    label: 'Live MIB refresh policy',
    classification: 'settings-backed',
    owner: 'live-mibs',
    settingsSection: 'liveMibs',
    rationale: 'Persistent polling cadence can affect device load and background behavior.',
  },
  {
    id: 'tools.active-section',
    label: 'Tools active section',
    classification: 'contextual-only',
    owner: 'tools',
    rationale: 'Ephemeral page navigation state; it is not persisted or reused outside Tools.',
  },
  {
    id: 'tools.export-format',
    label: 'One-off export format choices',
    classification: 'contextual-only',
    owner: 'tools',
    rationale: 'Export buttons select an immediate action and do not persist a product default.',
  },
  {
    id: 'resolver.consent-prompt-response',
    label: 'Per-prompt external access consent response',
    classification: 'constrained',
    owner: 'resolver',
    rationale:
      'Consent is intentionally captured at the disclosure prompt; Settings only exposes revocation.',
  },
] as const satisfies readonly PreferenceCatalogEntry[];

export function settingsBackedPreferenceIds(
  entries: readonly PreferenceCatalogEntry[] = PREFERENCE_CATALOG,
): string[] {
  return entries
    .filter((entry) => entry.classification === 'settings-backed')
    .map((entry) => entry.id)
    .sort();
}

export function assertPreferenceCatalogCoverage(
  entries: readonly PreferenceCatalogEntry[] = PREFERENCE_CATALOG,
): void {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new Error(`Duplicate preference catalog id: ${entry.id}`);
    ids.add(entry.id);
    if (!entry.rationale.trim()) throw new Error(`Missing rationale for ${entry.id}`);
    if (entry.classification === 'settings-backed' && !entry.settingsSection) {
      throw new Error(`Settings-backed preference ${entry.id} needs a settingsSection`);
    }
  }
}
