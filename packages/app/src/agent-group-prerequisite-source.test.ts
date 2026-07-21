import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

describe('agent group prerequisite completion', () => {
  it('prevents empty group creation and explains how to add members in context', () => {
    const source = fs.readFileSync('packages/app/src/screens/AgentsScreen.tsx', 'utf8');

    expect(source).toContain('Select at least one saved profile before creating a group.');
    expect(source).toContain(
      'disabled={!groupName.trim() || !groupMembers.length || collectionBlocked}',
    );
  });
});
