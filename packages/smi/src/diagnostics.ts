export type ParseDiagnosticSeverity = 'info' | 'recovered' | 'warning' | 'error';

export interface ParseDiagnostic {
  severity: ParseDiagnosticSeverity;
  file?: string;
  module?: string;
  line?: number;
  symbol?: string;
  message: string;
  recovery?: string;
}
