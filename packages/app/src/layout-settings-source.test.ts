import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

describe('layout settings', () => {
  it('exposes persisted split and dock resets in Settings', () => {
    const settings = fs.readFileSync('packages/app/src/screens/SettingsScreen.tsx', 'utf8');
    const navigation = fs.readFileSync('packages/app/src/settings-navigation.ts', 'utf8');

    expect(navigation).toContain("{ id: 'layout', label: 'Layout' }");
    expect(settings).toContain('<SectionTitle>Layout</SectionTitle>');
    expect(settings).toContain('Reset split panes');
    expect(settings).toContain('Reset packet dock');
    expect(settings).toContain('resetSplitWorkspaceLayouts()');
    expect(settings).toContain('resetVerticalDockLayouts()');
  });
});
