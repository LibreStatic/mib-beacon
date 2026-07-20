import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./screens/AgentsScreen.tsx', import.meta.url), 'utf8');

describe('compact agent profile management', () => {
  it('separates profiles and groups into reachable compact sections', () => {
    expect(source).toContain('useResponsiveLayout()');
    expect(source).toContain("useState<AgentManagementSection>('profiles')");
    expect(source).toContain('accessibilityRole="radiogroup"');
    expect(source).toContain('accessibilityRole="radio"');
    expect(source).toContain('accessibilityState={{ checked: selected }}');
    expect(source).toContain('aria-checked={selected}');
    expect(source).toContain("managementSection === 'profiles'");
    expect(source).toContain("managementSection === 'groups'");
  });

  it('keeps profile actions explicit and independently busy', () => {
    expect(source).toContain('title="Edit"');
    expect(source).toContain('title="Test"');
    expect(source).toContain('title="Delete"');
    expect(source).toContain('testingId');
    expect(source).toContain('deletingId');
    expect(source).toContain('editorBusy');
  });

  it('uses the shared cross-platform dialog for destructive confirmation', () => {
    expect(source).toContain('deleteCandidate');
    expect(source).toContain('title="Delete agent profile?"');
    expect(source).not.toContain('Alert.alert');
  });
});
