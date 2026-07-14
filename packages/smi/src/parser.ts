import type { ParseDiagnostic } from './diagnostics';
import { MibStore } from './mib-store';
import type { MibTextFile } from './types';

export interface NormalizedMibSource extends MibTextFile {
  diagnostics: ParseDiagnostic[];
}

export interface ParsedFile {
  name: string;
  status: 'ok' | 'recovered-with-diagnostics' | 'failed';
  modules: string[];
  diagnostics: ParseDiagnostic[];
}

export interface ParsedBatch {
  loaded: string[];
  files: ParsedFile[];
  diagnostics: ParseDiagnostic[];
}

export interface IncrementalParseOptions {
  yieldEvery?: number;
  onProgress?: (progress: { completed: number; total: number; file: ParsedFile }) => void;
}

export function normalizeMibSource(source: MibTextFile): NormalizedMibSource {
  const diagnostics: ParseDiagnostic[] = [];
  let content = source.content;
  if (content.startsWith('\uFEFF')) {
    content = content.slice(1);
    diagnostics.push(
      recovered(source.name, 1, 'Stripped UTF-8 byte-order mark', 'stripped UTF-8 BOM'),
    );
  }
  if (/\r/.test(content)) {
    content = content.replace(/\r\n?/g, '\n');
    diagnostics.push(
      recovered(source.name, 1, 'Normalized CR/CRLF line endings', 'normalized line endings'),
    );
  }
  if (/\t/.test(content)) {
    const line = firstLineOf(content, /\t/);
    content = content.replace(/\t/g, '  ');
    diagnostics.push(
      recovered(source.name, line, 'Expanded tab characters', 'expanded tab characters'),
    );
  }
  if (/\f/.test(content)) {
    const line = firstLineOf(content, /\f/);
    content = content.replace(/\f/g, '\n');
    diagnostics.push(
      recovered(
        source.name,
        line,
        'Replaced formfeed page break',
        'replaced formfeed with newline',
      ),
    );
  }
  // eslint-disable-next-line no-control-regex -- these are the exact invalid SMI bytes we remove
  const controlCharacters = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
  content = content.replace(controlCharacters, (character, offset) => {
    const code = character.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0');
    diagnostics.push(
      recovered(
        source.name,
        lineAt(content, offset),
        `Removed control character U+${code}`,
        `removed control character U+${code}`,
      ),
    );
    return '';
  });
  const identifierRecoveries = new Set<string>();
  content = replaceCodeIdentifiers(content, (identifier, offset) => {
    if (!identifier.includes('_')) return identifier;
    if (!identifierRecoveries.has(identifier)) {
      diagnostics.push(
        recovered(
          source.name,
          lineAt(content, offset),
          `Replaced underscores in identifier ${identifier}`,
          `replaced underscore in identifier ${identifier}`,
        ),
      );
      identifierRecoveries.add(identifier);
    }
    return identifier.replace(/_/g, '-');
  });
  const structure = structureOnly(content);
  if (
    /\{\s*enterprises\b/i.test(structure) &&
    !/\bIMPORTS\b[\s\S]*?\benterprises\b[\s\S]*?;/i.test(structure)
  ) {
    if (/\bIMPORTS\b/i.test(structure)) {
      content = content.replace(/\bIMPORTS\b/i, 'IMPORTS\n  enterprises FROM SNMPv2-SMI\n');
    } else {
      content = content.replace(
        /\b(?:PIB-)?DEFINITIONS\s*::=\s*BEGIN\b/i,
        (header) => `${header}\nIMPORTS enterprises FROM SNMPv2-SMI;`,
      );
    }
    diagnostics.push({
      severity: 'recovered',
      file: source.name,
      module: 'SNMPv2-SMI',
      symbol: 'enterprises',
      message: 'Injected omitted well-known enterprises import',
      recovery: 'injected enterprises import from SNMPv2-SMI',
    });
  }
  content = content.replace(
    /\bCounter64\s+FROM\s+([A-Za-z][A-Za-z0-9-]*)/gi,
    (clause, provider: string, offset: number) => {
      if (provider.toUpperCase() === 'SNMPV2-SMI') return clause;
      diagnostics.push({
        severity: 'recovered',
        file: source.name,
        module: 'SNMPv2-SMI',
        line: lineAt(content, offset),
        symbol: 'Counter64',
        message: `Counter64 was imported from ${provider}; its standard provider is SNMPv2-SMI`,
        recovery: `rewrote Counter64 import from ${provider} to SNMPv2-SMI`,
      });
      return 'Counter64 FROM SNMPv2-SMI';
    },
  );
  content = sanitizeDescriptions(content, source.name, diagnostics);
  content = dropUnresolvedOidAssignments(content, source.name, diagnostics);
  addMacroCompatibilityDiagnostics(content, source.name, diagnostics);
  return { ...source, content, diagnostics };
}

export function parseModules(input: MibTextFile[]): ParsedBatch {
  const store = new MibStore();
  return batchFromFiles(input.map((source) => parseSource(store, source)));
}

export async function parseModulesIncremental(
  input: MibTextFile[],
  options: IncrementalParseOptions = {},
): Promise<ParsedBatch> {
  const store = new MibStore();
  const files: ParsedFile[] = [];
  const yieldEvery = Math.max(1, options.yieldEvery ?? 1);
  for (const [index, source] of input.entries()) {
    const file = parseSource(store, source);
    files.push(file);
    options.onProgress?.({ completed: index + 1, total: input.length, file });
    if ((index + 1) % yieldEvery === 0 && index + 1 < input.length) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  return batchFromFiles(files);
}

function parseSource(store: MibStore, source: MibTextFile): ParsedFile {
  const normalized = normalizeMibSource(source);
  const diagnostics = [...normalized.diagnostics];
  const moduleNames = definedModules(normalized.content);
  let content = normalized.content;
  if (moduleNames.length > 0 && !/\bEND\s*$/i.test(structureOnly(content).trim())) {
    content = `${content.trimEnd()}\nEND`;
    diagnostics.push({
      severity: 'recovered',
      file: source.name,
      module: moduleNames[0],
      line: content.split('\n').length,
      message: 'Appended missing terminating END statement',
      recovery: 'appended terminating END',
    });
  }

  const result = store.importTexts([{ ...normalized, content }]);
  if (result.loaded.length > 0) {
    return {
      name: source.name,
      status: diagnostics.length > 0 ? 'recovered-with-diagnostics' : 'ok',
      modules: result.loaded,
      diagnostics,
    };
  }

  for (const error of result.errors) {
    if (error.missingImports?.length) {
      for (const missing of error.missingImports) {
        diagnostics.push({
          severity: 'error',
          file: source.name,
          module: missing.module,
          symbol: missing.symbols.join(', '),
          message: `Missing import ${missing.symbols.join(', ')} from ${missing.module}`,
        });
      }
    } else {
      diagnostics.push({ severity: 'error', file: source.name, message: error.message });
    }
  }
  return { name: source.name, status: 'failed', modules: [], diagnostics };
}

function batchFromFiles(files: ParsedFile[]): ParsedBatch {
  return {
    loaded: files.flatMap((file) => file.modules),
    files,
    diagnostics: files.flatMap((file) => file.diagnostics),
  };
}

function recovered(file: string, line: number, message: string, recovery: string): ParseDiagnostic {
  return { severity: 'recovered', file, line, message, recovery };
}

function firstLineOf(content: string, pattern: RegExp): number {
  const offset = content.search(pattern);
  return offset < 0 ? 1 : lineAt(content, offset);
}

function lineAt(content: string, offset: number): number {
  return content.slice(0, offset).split('\n').length;
}

function definedModules(content: string): string[] {
  return [
    ...structureOnly(content).matchAll(
      /\b([A-Za-z][A-Za-z0-9-]*)\s+(?:PIB-)?DEFINITIONS\s*::=\s*BEGIN\b/gi,
    ),
  ].flatMap((match) => (match[1] ? [match[1]] : []));
}

function structureOnly(content: string): string {
  return content.replace(/--[^\r\n]*/g, '').replace(/"(?:""|[^"])*"/g, '""');
}

function replaceCodeIdentifiers(
  content: string,
  transform: (identifier: string, offset: number) => string,
): string {
  let output = '';
  let offset = 0;
  let inString = false;
  let inComment = false;
  while (offset < content.length) {
    const character = content[offset]!;
    const next = content[offset + 1];
    if (inComment) {
      output += character;
      offset += 1;
      if (character === '\n' || character === '\r') inComment = false;
      continue;
    }
    if (inString) {
      output += character;
      offset += 1;
      if (character === '"' && next === '"') {
        output += next;
        offset += 1;
      } else if (character === '"') inString = false;
      continue;
    }
    if (character === '-' && next === '-') {
      output += '--';
      offset += 2;
      inComment = true;
      continue;
    }
    if (character === '"') {
      output += character;
      offset += 1;
      inString = true;
      continue;
    }
    if (/[A-Za-z]/.test(character)) {
      const match = content.slice(offset).match(/^[A-Za-z][A-Za-z0-9_-]*/)!;
      output += transform(match[0], offset);
      offset += match[0].length;
      continue;
    }
    output += character;
    offset += 1;
  }
  return output;
}

function sanitizeDescriptions(
  content: string,
  file: string,
  diagnostics: ParseDiagnostic[],
): string {
  return content.replace(
    /(\bDESCRIPTION\s+")([\s\S]*?)("\s*)(?=(?:REFERENCE|DEFVAL|INDEX|AUGMENTS|::=))/gi,
    (whole, opening: string, body: string, closing: string, offset: number) => {
      const sentinel = '\uE000';
      const sanitized = body
        .replace(/[“”]/g, "'")
        .replace(/''/g, "'")
        .replace(/""/g, sentinel)
        .replace(/"/g, '""')
        .replaceAll(sentinel, '""');
      if (sanitized === body) return whole;
      diagnostics.push({
        severity: 'recovered',
        file,
        line: lineAt(content, offset),
        message: 'Sanitized malformed punctuation and unescaped quotes in DESCRIPTION',
        recovery: 'sanitized DESCRIPTION string',
      });
      return `${opening}${sanitized}${closing}`;
    },
  );
}

function dropUnresolvedOidAssignments(
  content: string,
  file: string,
  diagnostics: ParseDiagnostic[],
): string {
  const structure = structureOnly(content);
  const known = new Set(['iso', 'ccitt', 'joint-iso-ccitt']);
  for (const match of structure.matchAll(
    /\b([A-Za-z][A-Za-z0-9-]*)\s+(?:OBJECT IDENTIFIER|OBJECT-TYPE|MODULE-IDENTITY|OBJECT-IDENTITY|NOTIFICATION-TYPE)\b/gi,
  )) {
    if (match[1]) known.add(match[1]);
  }
  for (const clause of structure.matchAll(/\bIMPORTS\b([\s\S]*?);/gi)) {
    for (const group of clause[1]?.matchAll(
      /([A-Za-z][A-Za-z0-9-]*(?:\s*,\s*[A-Za-z][A-Za-z0-9-]*)*)\s+FROM\s+[A-Za-z][A-Za-z0-9-]*/gi,
    ) ?? []) {
      group[1]?.split(/\s*,\s*/).forEach((symbol) => known.add(symbol));
    }
  }
  return content.replace(
    /(^|\n)([ \t]*)([A-Za-z][A-Za-z0-9-]*)\s+OBJECT IDENTIFIER\s*::=\s*\{\s*([A-Za-z][A-Za-z0-9-]*)\s+\d+\s*\}[^\r\n]*/gi,
    (whole, prefix: string, _indent: string, symbol: string, parent: string, offset: number) => {
      if (known.has(parent)) return whole;
      diagnostics.push({
        severity: 'warning',
        file,
        line: lineAt(content, offset),
        symbol,
        message: `Dropped ${symbol} because parent ${parent} cannot be resolved`,
        recovery: 'kept loadable objects and dropped unresolved object',
      });
      return prefix;
    },
  );
}

function addMacroCompatibilityDiagnostics(
  content: string,
  file: string,
  diagnostics: ParseDiagnostic[],
): void {
  const structure = structureOnly(content);
  const module = definedModules(content)[0];
  const identityCount = [...structure.matchAll(/\bMODULE-IDENTITY\b/gi)].length;
  if (/\bOBJECT-TYPE\b/i.test(structure) && identityCount === 0) {
    diagnostics.push({
      severity: 'warning',
      file,
      module,
      message: 'Module defines managed objects without a MODULE-IDENTITY declaration',
      recovery: 'accepted module without MODULE-IDENTITY',
    });
  } else if (identityCount > 1) {
    diagnostics.push({
      severity: 'warning',
      file,
      module,
      message: `Module contains ${identityCount} MODULE-IDENTITY declarations`,
      recovery: 'accepted duplicate MODULE-IDENTITY declarations',
    });
  }
  if (/\bACCESS\b/i.test(structure) && /\bMAX-ACCESS\b/i.test(structure)) {
    diagnostics.push({
      severity: 'warning',
      file,
      module,
      message: 'Module mixes SMIv1 ACCESS with SMIv2 MAX-ACCESS clauses',
      recovery: 'accepted mixed SMIv1 and SMIv2 access macros',
    });
  }
  for (const match of structure.matchAll(
    /(?:^|\n)[ \t]*([A-Z][A-Za-z0-9-]*)\s+(?:OBJECT IDENTIFIER|OBJECT-TYPE|OBJECT-IDENTITY|NOTIFICATION-TYPE|MODULE-IDENTITY)\b/g,
  )) {
    diagnostics.push({
      severity: 'warning',
      file,
      module,
      line: match.index === undefined ? undefined : lineAt(structure, match.index),
      symbol: match[1],
      message: `Value identifier ${match[1]} starts with an uppercase letter`,
      recovery: 'accepted uppercase value identifier',
    });
  }
}
