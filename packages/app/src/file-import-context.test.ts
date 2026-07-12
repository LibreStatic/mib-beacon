import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FileImportProvider, useFileImportAdapter, type FileImportAdapter } from './file-import-context';

describe('FileImportProvider', () => {
  it('makes the host acquisition adapter reachable to shared UI', () => {
    const adapter: FileImportAdapter = {
      platform: 'ios',
      destinationLabel: 'Device engine',
      acquireFiles: async () => ({ status: 'cancelled', files: [] }),
      acquireDirectory: async () => ({ status: 'unsupported', files: [], message: 'Choose a ZIP instead.' }),
    };
    const Probe = () => {
      const value = useFileImportAdapter();
      return createElement('span', null, `${value.platform}:${value.destinationLabel}`);
    };
    const html = renderToStaticMarkup(createElement(FileImportProvider, { adapter }, createElement(Probe)));
    expect(html).toContain('ios:Device engine');
  });
});
