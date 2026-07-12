import { MibStore } from './mib-store';

export type MibParseCheck = { ok: true } | { ok: false; message: string };

interface MissingImport {
  module: string;
  symbols: string[];
}

/** Parse-check in an isolated store; temporary import stubs allow compilation without mutating the catalog. */
export function parseCheckMibText(content: string): MibParseCheck {
  const first = new MibStore().importTexts([{ name: 'resolver-check.mib', content }]);
  if (first.loaded.length > 0) return { ok: true };
  const missing = first.errors.flatMap((error) => error.missingImports ?? []);
  if (missing.length === 0 || first.errors.some((error) => error.code !== 'MIB_MISSING_IMPORTS')) {
    return { ok: false, message: first.errors[0]?.message ?? 'MIB parser rejected the document' };
  }

  const declarationBody = content
    .replace(/--[^\r\n]*/g, '')
    .replace(/\bIMPORTS\b[\s\S]*?;/i, '')
    .replace(/\b[A-Za-z][A-Za-z0-9-]*\s+(?:PIB-)?DEFINITIONS\s*::=\s*BEGIN\b/i, '')
    .replace(/\bEND\s*$/i, '')
    .trim();
  if (!declarationBody.includes('::=')) {
    return { ok: false, message: 'MIB module contains no valid declarations' };
  }

  const store = new MibStore();
  const stubs = mergeImports(missing).map(({ module, symbols }, moduleIndex) => ({
    name: `${module}.mib`,
    content: `${module} DEFINITIONS ::= BEGIN\n${symbols
      .map((symbol, symbolIndex) => `${symbol} OBJECT IDENTIFIER ::= { iso ${1000 + moduleIndex * 100 + symbolIndex} }`)
      .join('\n')}\nEND`,
  }));
  const stubResult = store.importTexts(stubs);
  if (stubResult.errors.length > 0) {
    return { ok: false, message: `could not construct dependency parse stubs: ${stubResult.errors[0]!.message}` };
  }
  const result = store.importTexts([{ name: 'resolver-check.mib', content }]);
  return result.loaded.length > 0
    ? { ok: true }
    : { ok: false, message: result.errors[0]?.message ?? 'MIB parser rejected the document' };
}

function mergeImports(imports: MissingImport[]): MissingImport[] {
  const modules = new Map<string, Set<string>>();
  for (const item of imports) {
    const symbols = modules.get(item.module) ?? new Set<string>();
    for (const symbol of item.symbols) symbols.add(symbol);
    modules.set(item.module, symbols);
  }
  return [...modules].map(([module, symbols]) => ({ module, symbols: [...symbols] }));
}
