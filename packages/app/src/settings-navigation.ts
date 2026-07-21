export const SETTINGS_SECTIONS = [
  { id: 'appearance', label: 'Appearance & access' },
  { id: 'liveMibs', label: 'Live MIBs' },
  { id: 'updates', label: 'Updates' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'layout', label: 'Layout' },
  { id: 'privacy', label: 'Privacy & automation' },
  { id: 'cache', label: 'Dependency cache' },
  { id: 'sources', label: 'Source priority' },
  { id: 'transfer', label: 'Import / export' },
  { id: 'activity', label: 'Recent activity' },
  { id: 'about', label: 'About' },
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]['id'];
export type SettingsSectionOffsets = Partial<Record<SettingsSectionId, number>>;

export function getActiveSettingsSection(
  offsets: SettingsSectionOffsets,
  scrollY: number,
  threshold = 48,
  atEnd = false,
): SettingsSectionId {
  if (atEnd) return SETTINGS_SECTIONS[SETTINGS_SECTIONS.length - 1]!.id;
  let active: SettingsSectionId = 'appearance';
  const viewportPosition = scrollY + threshold;
  for (const section of SETTINGS_SECTIONS) {
    const offset = offsets[section.id];
    if (offset !== undefined && offset <= viewportPosition) active = section.id;
  }
  return active;
}
