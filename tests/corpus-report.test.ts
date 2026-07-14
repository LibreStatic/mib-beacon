import { describe, expect, it } from 'vitest';
import {
  classifyCorpusFailure,
  summarizeCorpusResults,
  type CorpusFileResult,
} from '../dev/corpus/report';

describe('corpus report summary', () => {
  it.each([
    ['no MIB module definition found in file', 'MIB_NO_DEFINITION'],
    ['MIB module definition has no terminating END statement', 'MIB_TRUNCATED'],
    ['MIB module contains no valid declarations', 'MIB_NO_DECLARATIONS'],
    ["Cannot read properties of undefined (reading 'includes')", 'MIB_PARSER_EXCEPTION'],
    ['unexpected token on line 12', 'MIB_PARSE_FAILED'],
  ])('classifies %s as %s', (message, expected) => {
    expect(classifyCorpusFailure(message)).toBe(expected);
  });

  it('counts outcomes, ranks failure causes, and reports the slowest files', () => {
    const files: CorpusFileResult[] = [
      { corpus: 'netdisco', path: 'ok.mib', status: 'ok', durationMs: 3 },
      {
        corpus: 'netdisco',
        path: 'recovered.mib',
        status: 'recovered-with-diagnostics',
        durationMs: 8,
        diagnostics: [{ severity: 'recovered', message: 'Appended END' }],
      },
      {
        corpus: 'netdisco',
        path: 'broken-a.mib',
        status: 'failed',
        durationMs: 2,
        errorClass: 'MIB_PARSE_FAILED',
      },
      {
        corpus: 'librenms',
        path: 'broken-b.mib',
        status: 'failed',
        durationMs: 12,
        errorClass: 'MIB_PARSE_FAILED',
      },
      {
        corpus: 'librenms',
        path: 'missing.mib',
        status: 'failed',
        durationMs: 5,
        errorClass: 'MIB_MISSING_IMPORTS',
      },
    ];

    expect(summarizeCorpusResults(files)).toEqual({
      totals: { files: 5, ok: 1, recovered: 1, failed: 3, okOrRecoveredRate: 40 },
      byCorpus: {
        netdisco: { files: 3, ok: 1, recovered: 1, failed: 1, okOrRecoveredRate: 66.67 },
        librenms: { files: 2, ok: 0, recovered: 0, failed: 2, okOrRecoveredRate: 0 },
      },
      topFailureCauses: [
        { errorClass: 'MIB_PARSE_FAILED', count: 2 },
        { errorClass: 'MIB_MISSING_IMPORTS', count: 1 },
      ],
      slowestFiles: [
        { corpus: 'librenms', path: 'broken-b.mib', durationMs: 12, status: 'failed' },
        {
          corpus: 'netdisco',
          path: 'recovered.mib',
          durationMs: 8,
          status: 'recovered-with-diagnostics',
        },
        { corpus: 'librenms', path: 'missing.mib', durationMs: 5, status: 'failed' },
        { corpus: 'netdisco', path: 'ok.mib', durationMs: 3, status: 'ok' },
        { corpus: 'netdisco', path: 'broken-a.mib', durationMs: 2, status: 'failed' },
      ],
    });
  });
});
