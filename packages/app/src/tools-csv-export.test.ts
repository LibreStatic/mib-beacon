import { describe, expect, it } from 'vitest';
import toolsScreenSource from './screens/ToolsScreen.tsx?raw';

function graphCsvHandler(): string {
  const graphSection = toolsScreenSource.indexOf("section === 'graphs'");
  const csvButton = toolsScreenSource.indexOf('title="CSV"', graphSection);
  const deleteButton = toolsScreenSource.indexOf('title="Delete"', csvButton);
  return toolsScreenSource.slice(csvButton, deleteButton);
}

describe('graph CSV export', () => {
  it('downloads CSV files in a web browser instead of using the unsupported share API', () => {
    const handler = graphCsvHandler();

    expect(handler).toContain("Platform.OS === 'web'");
    expect(handler).toContain('new Blob([csv]');
    expect(handler).toContain("type: 'text/csv");
    expect(handler).toContain('URL.createObjectURL');
    expect(handler).toContain('anchor.download');
    expect(handler).toContain('Share.share');
  });
});
