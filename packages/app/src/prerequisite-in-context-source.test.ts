import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

describe('in-context prerequisite completion', () => {
  it('lets Query create/select a saved profile without leaving the page', () => {
    const source = fs.readFileSync('packages/app/src/screens/QueryScreen.tsx', 'utf8');

    expect(source).toContain('AgentProfileDialog');
    expect(source).toContain('Save current target as profile');
    expect(source).toContain('Create a profile here');
    expect(source).toContain('selectAgentProfile(created)');
    expect(source).toContain("requestProfileThen({ kind: 'bookmark' })");
    expect(source).toContain("requestProfileThen({ kind: 'graph', value })");
    expect(source).toContain('resumePendingProfileAction');
    expect(source).toContain('Create and select group');
    expect(source).toContain('selectAgentGroup(created.id)');
    expect(source).not.toContain('Create an agent group in Manage profiles first.');
  });

  it('lets Trap Composer create/select a saved notification target in place', () => {
    const source = fs.readFileSync('packages/app/src/components/TrapComposerDialog.tsx', 'utf8');

    expect(source).toContain('AgentProfileDialog');
    expect(source).toContain('Save and use notification target');
    expect(source).toContain('setNotificationAgentId(created.id)');
    expect(source).toContain(
      'No saved notification targets yet. Create one here to keep composing.',
    );
  });

  it('lets Live MIBs import catalog data from the empty state', () => {
    const source = fs.readFileSync('packages/app/src/screens/LiveMibsScreen.tsx', 'utf8');

    expect(source).toContain('FileImportFlow');
    expect(source).toContain('Import MIBs here to populate Live MIB nodes.');
  });
});
