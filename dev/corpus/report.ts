export type CorpusFileStatus = 'ok' | 'recovered-with-diagnostics' | 'failed';

export interface CorpusFileResult {
  corpus: string;
  path: string;
  status: CorpusFileStatus;
  durationMs: number;
  errorClass?: string;
  diagnostics?: { severity: string; message: string }[];
}

export interface CorpusCounts {
  files: number;
  ok: number;
  recovered: number;
  failed: number;
  okOrRecoveredRate: number;
}

export interface CorpusReportSummary {
  totals: CorpusCounts;
  byCorpus: Record<string, CorpusCounts>;
  topFailureCauses: { errorClass: string; count: number }[];
  slowestFiles: Pick<CorpusFileResult, 'corpus' | 'path' | 'durationMs' | 'status'>[];
}

export function classifyCorpusFailure(message: string): string {
  if (/no MIB module definition found/i.test(message)) return 'MIB_NO_DEFINITION';
  if (/no terminating END statement/i.test(message)) return 'MIB_TRUNCATED';
  if (/no valid declarations/i.test(message)) return 'MIB_NO_DECLARATIONS';
  if (/Cannot read properties of (?:undefined|null)/i.test(message)) return 'MIB_PARSER_EXCEPTION';
  return 'MIB_PARSE_FAILED';
}

function count(files: CorpusFileResult[]): CorpusCounts {
  const ok = files.filter(({ status }) => status === 'ok').length;
  const recovered = files.filter(({ status }) => status === 'recovered-with-diagnostics').length;
  const failed = files.filter(({ status }) => status === 'failed').length;
  return {
    files: files.length,
    ok,
    recovered,
    failed,
    okOrRecoveredRate:
      files.length === 0 ? 0 : Math.round(((ok + recovered) / files.length) * 10_000) / 100,
  };
}

export function summarizeCorpusResults(files: CorpusFileResult[]): CorpusReportSummary {
  const corpusNames = [...new Set(files.map(({ corpus }) => corpus))];
  const byCorpus = Object.fromEntries(
    corpusNames.map((corpus) => [corpus, count(files.filter((file) => file.corpus === corpus))]),
  );
  const failures = new Map<string, number>();
  for (const file of files) {
    if (file.status !== 'failed') continue;
    const errorClass = file.errorClass ?? 'UNKNOWN';
    failures.set(errorClass, (failures.get(errorClass) ?? 0) + 1);
  }
  return {
    totals: count(files),
    byCorpus,
    topFailureCauses: [...failures.entries()]
      .map(([errorClass, failureCount]) => ({ errorClass, count: failureCount }))
      .sort(
        (left, right) =>
          right.count - left.count || left.errorClass.localeCompare(right.errorClass),
      )
      .slice(0, 10),
    slowestFiles: files
      .map(({ corpus, path, durationMs, status }) => ({ corpus, path, durationMs, status }))
      .sort(
        (left, right) => right.durationMs - left.durationMs || left.path.localeCompare(right.path),
      )
      .slice(0, 10),
  };
}
