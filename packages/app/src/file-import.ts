import { Unzip, UnzipInflate, unzip } from 'fflate';
import ClientMibParser from './vendor-net-snmp-mib-parser.js';
import { BASE_MIBS as CLIENT_BASE_MIBS } from './client-base-mibs.generated';

export const FILE_IMPORT_LIMITS = {
  maxCandidateBytes: 5 * 1024 * 1024,
  maxCompressedArchiveBytes: 25 * 1024 * 1024,
  maxExpandedBytes: 50 * 1024 * 1024,
  maxCandidates: 1000,
  maxCompressionRatio: 100,
} as const;

export interface RawSelectedFile {
  /** Acquisition identity; display paths are not unique (especially drag/drop). */
  id?: string;
  name: string;
  relativePath?: string;
  bytes: Uint8Array;
}

export type MibTextEncoding = 'utf-8' | 'latin1';

export interface PreparedMibCandidate {
  id: string;
  name: string;
  path: string;
  relativePath: string;
  text: string;
  encoding: MibTextEncoding;
  size: number;
  archive?: string;
  archiveId?: string;
}

export type FileImportRejectionReason =
  | 'hidden-or-system'
  | 'unsupported-extension'
  | 'candidate-too-large'
  | 'archive-too-large'
  | 'expanded-limit-exceeded'
  | 'candidate-limit-exceeded'
  | 'compression-ratio-exceeded'
  | 'encrypted-archive'
  | 'invalid-archive'
  | 'unsafe-path'
  | 'symlink'
  | 'nested-archive'
  | 'binary-content'
  | 'html-content'
  | 'non-smi-content';

export interface FileImportRejection {
  path: string;
  reason: FileImportRejectionReason;
  message: string;
}

export interface PreparedFileImport {
  candidates: PreparedMibCandidate[];
  rejections: FileImportRejection[];
  totalBytes: number;
}

export interface FileReviewModuleInfo { name: string; objectCount: number; isBase: boolean }
export interface LocalMibImport { module: string; symbols: string[]; external: boolean }
export interface FileReviewCollision {
  module: string;
  kind: 'base' | 'loaded-user' | 'batch-duplicate';
  replacementGroup?: string[];
}
export interface FileImportReviewFile {
  id: string;
  path: string;
  candidate: PreparedMibCandidate;
  modules: string[];
  imports: LocalMibImport[];
  warnings: string[];
  errors: string[];
  collisions: FileReviewCollision[];
  blocked: boolean;
}
export interface FileImportReview {
  files: FileImportReviewFile[];
  rejections: (FileImportRejection | FileAcquisitionRejection)[];
  totalBytes: number;
  /** Candidate IDs, never display paths. */
  duplicateDefinitions: { module: string; files: string[] }[];
  externalMissingImports: { module: string; symbols: string[]; requestedBy: string[] }[];
  replacementGroups: string[][];
}

/** Preserve code/newlines while masking SMI comments and multiline doubled-quote strings. */
function lexicalSource(text: string): string {
  const output = [...text];
  let inString = false;
  let inComment = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (inComment) {
      if (char === '\n' || char === '\r') inComment = false;
      else output[index] = ' ';
      continue;
    }
    if (inString) {
      if (char === '"' && text[index + 1] === '"') {
        output[index] = output[index + 1] = ' ';
        index += 1;
      } else if (char === '"') {
        output[index] = ' ';
        inString = false;
      } else if (char !== '\n' && char !== '\r') output[index] = ' ';
      continue;
    }
    if (char === '-' && text[index + 1] === '-') {
      output[index] = output[index + 1] = ' ';
      index += 1;
      inComment = true;
    } else if (char === '"') {
      output[index] = ' ';
      inString = true;
    }
  }
  return output.join('');
}

/** Renderer-safe lexical scan. It intentionally does not parse or execute SMI. */
export function scanMibMetadata(text: string): { modules: string[]; imports: { module: string; symbols: string[] }[] } {
  const source = lexicalSource(text);
  const modules = [...source.matchAll(/\b([A-Za-z][A-Za-z0-9-]*)\s+DEFINITIONS\s*::=\s*BEGIN\b/gi)]
    .map((match) => match[1]!)
    .filter((module, index, all) => all.indexOf(module) === index);
  const imports: { module: string; symbols: string[] }[] = [];
  for (const match of source.matchAll(/\bIMPORTS\b([\s\S]*?);/gi)) {
    const block = match[1]!;
    const tokens = block.match(/[A-Za-z][A-Za-z0-9-]*|,/g) ?? [];
    let symbols: string[] = [];
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index]!;
      if (token.toUpperCase() !== 'FROM') {
        if (token !== ',') symbols.push(token);
        continue;
      }
      const module = tokens[index + 1];
      if (module) imports.push({ module, symbols: [...new Set(symbols)] });
      symbols = [];
      index += 1;
    }
  }
  return { modules, imports };
}

export function structuralMibDiagnostics(text: string): string[] {
  const source = lexicalSource(text);
  const errors: string[] = [];
  const starts = [...source.matchAll(/\b([A-Za-z][A-Za-z0-9-]*)\s+DEFINITIONS\s*::=\s*BEGIN\b/gi)];
  const ends = [...source.matchAll(/\bEND\b/g)];
  if (starts.length === 0) errors.push('No module boundary was found.');
  if (ends.length < starts.length) errors.push('A module is missing its closing END.');
  if (ends.length > starts.length) errors.push('An END appears without a matching module boundary.');

  const stack: { char: '(' | '{'; offset: number }[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(' || char === '{') stack.push({ char, offset: index });
    if (char === ')' || char === '}') {
      const expected = char === ')' ? '(' : '{';
      if (stack.at(-1)?.char === expected) stack.pop();
      else errors.push(`Unbalanced ${char} at offset ${index}.`);
    }
  }
  for (const item of stack) errors.push(`Unbalanced ${item.char} at offset ${item.offset}.`);

  const importCount = [...source.matchAll(/\bIMPORTS\b/gi)].length;
  const terminatedImportCount = [...source.matchAll(/\bIMPORTS\b[\s\S]*?;/gi)].length;
  if (terminatedImportCount < importCount) errors.push('IMPORTS is missing its terminating semicolon.');

  const declarationSource = maskImportClauses(source);
  const declarations = [...declarationSource.matchAll(/\b([A-Za-z][A-Za-z0-9-]*)\s+(MODULE-IDENTITY|OBJECT-TYPE|OBJECT\s+IDENTIFIER|NOTIFICATION-TYPE|TRAP-TYPE|TEXTUAL-CONVENTION|OBJECT-GROUP|NOTIFICATION-GROUP|MODULE-COMPLIANCE)\b/gi)];
  for (let index = 0; index < declarations.length; index += 1) {
    const declaration = declarations[index]!;
    const end = declarations[index + 1]?.index ?? declarationSource.search(/\bEND\b/g);
    const boundary = end > declaration.index! ? end : declarationSource.length;
    if (!declarationSource.slice(declaration.index!, boundary).includes('::=')) {
      errors.push(`${declaration[1]} ${declaration[2]} is missing its ::= assignment.`);
    }
  }
  return [...new Set(errors)];
}

function maskImportClauses(source: string): string {
  return source.replace(/\bIMPORTS\b[\s\S]*?(?:;|(?=\bEND\b)|$)/gi, (clause) => clause.replace(/[^\r\n]/g, ' '));
}

function hasRealDeclaration(text: string): boolean {
  const source = maskImportClauses(lexicalSource(text))
    .replace(/\b[A-Za-z][A-Za-z0-9-]*\s+(?:PIB-)?DEFINITIONS\s*::=\s*BEGIN\b/gi, ' ')
    .replace(/\bEND\b/gi, ' ');
  return source.includes('::=');
}

const CLIENT_BASE_BY_NAME = new Map(CLIENT_BASE_MIBS.map((mib) => [mib.name, mib]));

function requiredBaseMibs(candidates: readonly PreparedMibCandidate[]) {
  const required = new Set<string>();
  const visit = (module: string) => {
    if (required.has(module)) return;
    const base = CLIENT_BASE_BY_NAME.get(module);
    if (!base) return;
    required.add(module);
    for (const dependency of scanMibMetadata(base.content).imports) visit(dependency.module);
  };
  for (const candidate of candidates) for (const item of scanMibMetadata(candidate.text).imports) visit(item.module);
  return CLIENT_BASE_MIBS.filter((mib) => required.has(mib.name));
}

function dependencyStubs(candidates: readonly PreparedMibCandidate[]): { name: string; content: string }[] {
  const imports = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    for (const item of scanMibMetadata(candidate.text).imports) {
      if (CLIENT_BASE_BY_NAME.has(item.module)) continue;
      const symbols = imports.get(item.module) ?? new Set<string>();
      item.symbols.forEach((symbol) => symbols.add(symbol));
      imports.set(item.module, symbols);
    }
  }
  const usage = candidates.map((candidate) => maskImportClauses(lexicalSource(candidate.text))).join('\n');
  return [...imports].map(([module, symbols], moduleIndex) => ({
    name: `${module}.stub`,
    content: `${module} DEFINITIONS ::= BEGIN\n${[...symbols]
      .map((symbol, symbolIndex) => {
        const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (new RegExp(`\\bSYNTAX\\s+(?:SEQUENCE\\s+OF\\s+)?${escaped}\\b`, 'i').test(usage)) {
          return `${symbol} ::= TEXTUAL-CONVENTION\n STATUS current\n DESCRIPTION "Client validation dependency stub"\n SYNTAX OCTET STRING`;
        }
        return `${symbol} OBJECT IDENTIFIER ::= { iso ${1000 + moduleIndex * 100 + symbolIndex} }`;
      })
      .join('\n')}\nEND`,
  }));
}

function parseSemanticBatch(candidates: readonly PreparedMibCandidate[]): string | null {
  try {
    if (candidates.some((candidate) => !hasRealDeclaration(candidate.text))) {
      return 'MIB module contains no real declaration assignment';
    }
    const parser = new ClientMibParser();
    for (const base of requiredBaseMibs(candidates)) parser.ParseModule(`${base.name}.base`, base.content);
    parser.Serialize();
    for (const stub of dependencyStubs(candidates)) parser.ParseModule(stub.name, stub.content);
    parser.Serialize();
    for (const candidate of candidates) parser.ParseModule(candidate.id, candidate.text);
    parser.Serialize();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Full client-side node-net-snmp semantic parse; isolated, async-yielded, and filesystem-free. */
export async function semanticMibDiagnostics(candidates: readonly PreparedMibCandidate[]): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  for (const candidate of candidates) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const error = parseSemanticBatch([candidate]);
    if (error) result.set(candidate.id, [`Semantic SMI parse failed: ${error}`]);
  }
  if (candidates.length > 1 && result.size === 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const batchError = parseSemanticBatch(candidates);
    if (batchError) {
      for (const candidate of candidates) result.set(candidate.id, [`Semantic batch parse failed: ${batchError}`]);
    }
  }
  return result;
}

const groupKey = (modules: readonly string[]) => [...modules].sort().join('|');

export function buildFileImportReview(
  prepared: PreparedFileImport,
  acquisitionRejections: readonly FileAcquisitionRejection[],
  loadedModules: readonly FileReviewModuleInfo[],
  replacementGroupsByModule: ReadonlyMap<string, string[]>,
  semanticErrors: ReadonlyMap<string, string[]> = new Map(),
): FileImportReview {
  const loaded = new Map(loadedModules.map((module) => [module.name, module]));
  const scans = prepared.candidates.map((candidate) => ({ candidate, ...scanMibMetadata(candidate.text), structuralErrors: structuralMibDiagnostics(candidate.text) }));
  const definitions = new Map<string, string[]>();
  for (const scan of scans) for (const module of scan.modules) definitions.set(module, [...(definitions.get(module) ?? []), scan.candidate.id]);
  const batchModules = new Set(definitions.keys());
  const external = new Map<string, { symbols: Set<string>; requestedBy: Set<string> }>();
  const files = scans.map(({ candidate, modules, imports, structuralErrors }) => {
    const collisions: FileReviewCollision[] = [];
    for (const module of modules) {
      const existing = loaded.get(module);
      if (existing) collisions.push({
        module,
        kind: existing.isBase ? 'base' : 'loaded-user',
        ...(!existing.isBase ? { replacementGroup: replacementGroupsByModule.get(module) ?? [module] } : {}),
      });
      if ((definitions.get(module)?.length ?? 0) > 1) collisions.push({ module, kind: 'batch-duplicate' });
    }
    const resolvedImports = imports.map((item) => {
      const isExternal = !loaded.has(item.module) && !batchModules.has(item.module);
      if (isExternal) {
        const value = external.get(item.module) ?? { symbols: new Set<string>(), requestedBy: new Set<string>() };
        item.symbols.forEach((symbol) => value.symbols.add(symbol));
        value.requestedBy.add(candidate.id);
        external.set(item.module, value);
      }
      return { ...item, external: isExternal };
    });
    const errors = [...(modules.length ? [] : ['No MIB module declaration was found.']), ...structuralErrors, ...(semanticErrors.get(candidate.id) ?? [])];
    return {
      id: candidate.id,
      path: candidate.path,
      candidate,
      modules,
      imports: resolvedImports,
      warnings: candidate.encoding === 'latin1' ? ['Decoded as Latin-1.'] : [],
      errors,
      collisions,
      blocked: errors.length > 0 || collisions.some((collision) => collision.kind === 'base'),
    };
  });
  const replacementGroups = [...new Map(
    [...replacementGroupsByModule.values()].map((group) => [groupKey(group), [...group].sort()]),
  ).values()];
  return {
    files,
    rejections: [...prepared.rejections, ...acquisitionRejections],
    totalBytes: prepared.totalBytes,
    duplicateDefinitions: [...definitions]
      .filter(([, owners]) => owners.length > 1)
      .map(([module, owners]) => ({ module, files: owners })),
    externalMissingImports: [...external].map(([module, value]) => ({
      module,
      symbols: [...value.symbols],
      requestedBy: [...value.requestedBy],
    })),
    replacementGroups,
  };
}

/** Builds review data locally; the callback receives module names only, never file content. */
export async function stageAcquiredFileImport(
  acquisition: Extract<AcquisitionResult, { status: 'selected' }>,
  loadedModules: readonly FileReviewModuleInfo[],
  replacementGroup: (moduleName: string) => Promise<string[] | null>,
): Promise<FileImportReview> {
  const prepared = await prepareFileImport(acquisition.files);
  const semanticErrors = await semanticMibDiagnostics(prepared.candidates);
  const loadedUsers = new Set(loadedModules.filter((module) => !module.isBase).map((module) => module.name));
  const colliding = new Set(prepared.candidates.flatMap((candidate) => scanMibMetadata(candidate.text).modules).filter((module) => loadedUsers.has(module)));
  const groups = new Map<string, string[]>();
  await Promise.all([...colliding].map(async (module) => {
    groups.set(module, await replacementGroup(module) ?? [module]);
  }));
  return buildFileImportReview(prepared, acquisition.rejections ?? [], loadedModules, groups, semanticErrors);
}

export function createInitialFileSelection(review: FileImportReview): Set<string> {
  const duplicateFiles = new Set(review.duplicateDefinitions.flatMap((duplicate) => duplicate.files));
  return new Set(review.files
    .filter((file) => !file.blocked && !duplicateFiles.has(file.id) && !file.collisions.some((collision) => collision.kind === 'loaded-user'))
    .map((file) => file.id));
}

export function validateFileImportSelection(
  review: FileImportReview,
  selectedPaths: ReadonlySet<string>,
  replacementGroupKeys: ReadonlySet<string>,
): { files: { name: string; relativePath: string; content: string }[]; replaceModules: string[]; errors: string[] } {
  const selected = review.files.filter((file) => selectedPaths.has(file.id));
  const errors: string[] = [];
  for (const file of selected) {
    if (file.blocked) errors.push(`${file.path} cannot be imported.`);
    for (const collision of file.collisions.filter((item) => item.kind === 'loaded-user')) {
      if (!replacementGroupKeys.has(groupKey(collision.replacementGroup ?? [collision.module]))) {
        errors.push(`${collision.module} is already loaded; choose Replace or skip its file.`);
      }
    }
  }
  for (const duplicate of review.duplicateDefinitions) {
    const count = duplicate.files.filter((id) => selectedPaths.has(id)).length;
    if (count !== 1) errors.push(`Choose exactly one file that defines ${duplicate.module}.`);
  }
  const incoming = new Set(selected.flatMap((file) => file.modules));
  const replaceModules: string[] = [];
  for (const group of review.replacementGroups) {
    if (!replacementGroupKeys.has(groupKey(group))) continue;
    if (!group.every((module) => incoming.has(module))) {
      errors.push(`Replacement must provide every module in the original source: ${group.join(', ')}.`);
    } else replaceModules.push(...group);
  }
  if (selected.length === 0 && errors.length === 0) errors.push('Choose at least one valid file to import.');
  return {
    files: errors.length ? [] : selected.map(({ candidate }) => ({ name: candidate.name, relativePath: candidate.path, content: candidate.text })),
    replaceModules: errors.length ? [] : [...new Set(replaceModules)],
    errors: [...new Set(errors)],
  };
}

export function retainedFileReviewAction(
  handleId: string,
  status?: { handleId: string; state: string } | null,
): 'wait' | 'discard' | 'reopen' {
  if (!status || status.handleId !== handleId) return 'wait';
  if (status.state === 'done') return 'discard';
  if (['partial', 'error', 'cancelled', 'expired'].includes(status.state)) return 'reopen';
  return 'wait';
}

export type FileImportLimits = typeof FILE_IMPORT_LIMITS;

const acceptedExtensions = new Set(['', '.mib', '.my', '.txt', '.asn1']);
const systemNames = new Set(['thumbs.db', 'desktop.ini', '.ds_store', '__macosx']);
const zipSignatures = new Set([0x04034b50, 0x06054b50, 0x08074b50]);

const normalizeSlashes = (path: string) => path.replaceAll('\\', '/').replace(/^\.\//, '');

const safePath = (path: string) => {
  const normalized = normalizeSlashes(path);
  if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) return null;
  const parts = normalized.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) return null;
  return parts.join('/');
};

const isHiddenOrSystem = (path: string) => normalizeSlashes(path).split('/').some((part) => part.startsWith('.') || systemNames.has(part.toLowerCase()));

const extensionOf = (path: string) => {
  const name = normalizeSlashes(path).split('/').at(-1) ?? '';
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
};

const readU16 = (bytes: Uint8Array, offset: number) => (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
const readU32 = (bytes: Uint8Array, offset: number) => (readU16(bytes, offset) | (readU16(bytes, offset + 2) << 16)) >>> 0;

interface ZipEntryMetadata {
  name: string;
  compressed: number;
  expanded: number;
  encrypted: boolean;
  symlink: boolean;
}

function zipMetadata(bytes: Uint8Array): ZipEntryMetadata[] {
  const result: ZipEntryMetadata[] = [];
  for (let offset = 0; offset <= bytes.length - 46; offset += 1) {
    if (readU32(bytes, offset) !== 0x02014b50) continue;
    const nameLength = readU16(bytes, offset + 28);
    const extraLength = readU16(bytes, offset + 30);
    const commentLength = readU16(bytes, offset + 32);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > bytes.length) throw new Error('Truncated ZIP directory');
    const name = decodeMibBytes(bytes.subarray(offset + 46, offset + 46 + nameLength)).text;
    const madeBy = readU16(bytes, offset + 4);
    const external = readU32(bytes, offset + 38);
    const unixMode = external >>> 16;
    result.push({
      name,
      compressed: readU32(bytes, offset + 20),
      expanded: readU32(bytes, offset + 24),
      encrypted: (readU16(bytes, offset + 8) & 1) !== 0,
      symlink: (madeBy >>> 8) === 3 && (unixMode & 0xf000) === 0xa000,
    });
    offset = end - 1;
  }
  if (result.length === 0) throw new Error('ZIP has no central directory entries');
  return result;
}

function isZip(bytes: Uint8Array, path: string) {
  return extensionOf(path) === '.zip' || (bytes.length >= 4 && zipSignatures.has(readU32(bytes, 0)));
}

export function decodeMibBytes(bytes: Uint8Array): { text: string; encoding: MibTextEncoding } {
  const content = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(content), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('latin1').decode(content), encoding: 'latin1' };
  }
}

function contentRejection(text: string, bytes: Uint8Array): Pick<FileImportRejection, 'reason' | 'message'> | null {
  if (bytes.includes(0) || bytes.reduce((count, byte) => count + (byte < 9 || (byte > 13 && byte < 32) ? 1 : 0), 0) > Math.max(4, bytes.length / 50)) {
    return { reason: 'binary-content', message: 'Binary content is not a MIB document.' };
  }
  if (/^\s*(?:<!doctype\s+html|<html\b)/i.test(text)) return { reason: 'html-content', message: 'HTML responses are not MIB documents.' };
  if (!/\b[A-Za-z][A-Za-z0-9-]*\s+DEFINITIONS\s*::=\s*BEGIN\b/i.test(text)) return { reason: 'non-smi-content', message: 'No SMI module declaration was found.' };
  return null;
}

const unzipWorker = (bytes: Uint8Array) => new Promise<Record<string, Uint8Array>>((resolve, reject) => {
  unzip(bytes, (error, data) => error ? reject(error) : resolve(data));
});
const yieldToHost = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function unzipReactNative(bytes: Uint8Array): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = {};
  let failure: unknown;
  const streams: Promise<void>[] = [];
  const archive = new Unzip((file) => {
    const chunks: Uint8Array[] = [];
    streams.push(new Promise<void>((resolve, reject) => {
      file.ondata = (error, chunk, final) => {
        if (error) { failure = error; reject(error); return; }
        if (chunk.length) chunks.push(chunk);
        if (final) {
          const size = chunks.reduce((sum, item) => sum + item.length, 0);
          const output = new Uint8Array(size);
          let offset = 0;
          for (const item of chunks) { output.set(item, offset); offset += item.length; }
          files[file.name] = output;
          resolve();
        }
      };
      try { file.start(); } catch (error) { failure = error; reject(error); }
    }));
  });
  archive.register(UnzipInflate);
  // A small compressed chunk also bounds output work for highly-compressible
  // MIB bundles. Yield before every push so React Native never requires Worker.
  const chunkBytes = 1024;
  for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
    await yieldToHost();
    const end = Math.min(bytes.length, offset + chunkBytes);
    archive.push(bytes.subarray(offset, end), end === bytes.length);
    if (failure) throw failure;
  }
  await Promise.all(streams);
  if (failure) throw failure;
  return files;
}

export type UnzipRuntime = 'worker' | 'react-native';
const detectedUnzipRuntime = (): UnzipRuntime =>
  typeof navigator !== 'undefined' && navigator.product === 'ReactNative' ? 'react-native' : 'worker';

export const unzipForRuntime = (
  bytes: Uint8Array,
  runtime: UnzipRuntime = detectedUnzipRuntime(),
): Promise<Record<string, Uint8Array>> => runtime === 'react-native' ? unzipReactNative(bytes) : unzipWorker(bytes);

export async function prepareFileImport(inputs: readonly RawSelectedFile[], overrides: Partial<FileImportLimits> = {}): Promise<PreparedFileImport> {
  const limits = { ...FILE_IMPORT_LIMITS, ...overrides };
  const candidates: PreparedMibCandidate[] = [];
  const rejections: FileImportRejection[] = [];
  let totalBytes = 0;
  let seen = 0;
  const reject = (path: string, reason: FileImportRejectionReason, message: string) => rejections.push({ path, reason, message });

  const usedIds = new Set<string>();
  const uniqueId = (requested: string) => {
    let id = requested;
    let suffix = 2;
    while (usedIds.has(id)) id = `${requested}#${suffix++}`;
    usedIds.add(id);
    return id;
  };
  const sources = inputs.map((input, index) => ({ ...input, id: uniqueId(input.id ?? `source-${index + 1}`) }));

  const acceptCandidate = (input: RawSelectedFile & { id: string }, path: string, archive?: { path: string; id: string }, count = true) => {
    if (count) seen += 1;
    if (seen > limits.maxCandidates) return reject(path, 'candidate-limit-exceeded', `Import is limited to ${limits.maxCandidates} candidates.`);
    if (isHiddenOrSystem(path)) return reject(path, 'hidden-or-system', 'Hidden and system files are skipped.');
    if (!acceptedExtensions.has(extensionOf(path))) return reject(path, 'unsupported-extension', 'Unsupported file extension.');
    if (input.bytes.length > limits.maxCandidateBytes) return reject(path, 'candidate-too-large', `Candidate exceeds ${limits.maxCandidateBytes} bytes.`);
    if (totalBytes + input.bytes.length > limits.maxExpandedBytes) return reject(path, 'expanded-limit-exceeded', `Import exceeds ${limits.maxExpandedBytes} expanded bytes.`);
    const decoded = decodeMibBytes(input.bytes);
    const invalid = contentRejection(decoded.text, input.bytes);
    if (invalid) return reject(path, invalid.reason, invalid.message);
    totalBytes += input.bytes.length;
    candidates.push({
      id: input.id,
      name: input.name,
      relativePath: path,
      path,
      text: decoded.text,
      encoding: decoded.encoding,
      size: input.bytes.length,
      ...(archive ? { archive: archive.path, archiveId: archive.id } : {}),
    });
  };

  const expandArchive = async (input: RawSelectedFile & { id: string }, path: string) => {
    if (input.bytes.length > limits.maxCompressedArchiveBytes) return reject(path, 'archive-too-large', `Archive exceeds ${limits.maxCompressedArchiveBytes} bytes.`);
    let metadata: ZipEntryMetadata[];
    try { metadata = zipMetadata(input.bytes); } catch (error) { return reject(path, 'invalid-archive', error instanceof Error ? error.message : 'Invalid ZIP archive.'); }
    if (metadata.length + seen > limits.maxCandidates) return reject(path, 'candidate-limit-exceeded', `Import is limited to ${limits.maxCandidates} candidates.`);
    seen += metadata.length;
    if (metadata.some((entry) => entry.encrypted)) return reject(path, 'encrypted-archive', 'Encrypted ZIP archives are not supported.');
    if (metadata.some((entry) => entry.expanded > 0 && entry.expanded / Math.max(1, entry.compressed) > limits.maxCompressionRatio)) return reject(path, 'compression-ratio-exceeded', `Archive exceeds the ${limits.maxCompressionRatio}:1 compression ratio limit.`);
    const expanded = metadata.reduce((sum, entry) => sum + entry.expanded, 0);
    if (expanded > limits.maxExpandedBytes - totalBytes) return reject(path, 'expanded-limit-exceeded', `Archive exceeds the ${limits.maxExpandedBytes} byte expanded limit.`);
    let entries: Record<string, Uint8Array>;
    try { entries = await unzipForRuntime(input.bytes); } catch (error) { return reject(path, 'invalid-archive', error instanceof Error ? error.message : 'Invalid ZIP archive.'); }
    const metadataByName = new Map(metadata.map((entry) => [normalizeSlashes(entry.name), entry]));
    let entryIndex = 0;
    for (const [rawName, bytes] of Object.entries(entries)) {
      const ordinal = entryIndex++;
      if (ordinal > 0 && ordinal % 25 === 0) await yieldToHost();
      const entryName = safePath(rawName);
      const attributed = `${path}/${normalizeSlashes(rawName)}`;
      if (!entryName) { reject(attributed, 'unsafe-path', 'Archive entry has an absolute or traversal path.'); continue; }
      if (rawName.endsWith('/')) continue;
      const entryPath = `${path}/${entryName}`;
      if (metadataByName.get(normalizeSlashes(rawName))?.symlink) { reject(entryPath, 'symlink', 'Symbolic links in archives are not supported.'); continue; }
      if (isZip(bytes, entryName)) { reject(entryPath, 'nested-archive', 'Nested ZIP archives are not expanded.'); continue; }
      acceptCandidate({ id: uniqueId(`${input.id}:entry:${ordinal}`), name: entryName.split('/').at(-1) ?? entryName, relativePath: entryPath, bytes }, entryPath, { path, id: input.id }, false);
    }
  };

  for (const input of sources) {
    const requestedPath = input.relativePath || input.name;
    const path = safePath(requestedPath);
    if (!path) { reject(requestedPath, 'unsafe-path', 'File has an absolute or traversal path.'); continue; }
    if (isHiddenOrSystem(path)) { reject(path, 'hidden-or-system', 'Hidden and system files are skipped.'); continue; }
    if (isZip(input.bytes, path)) await expandArchive(input, path);
    else acceptCandidate(input, path);
  }
  return { candidates, rejections, totalBytes };
}

export type FileAcquisitionRejectionReason = FileImportRejectionReason | 'aggregate-limit-exceeded' | 'directory-cycle' | 'directory-depth-exceeded' | 'read-failed';
export interface FileAcquisitionRejection { path: string; reason: FileAcquisitionRejectionReason; message: string }

export type AcquisitionResult =
  | { status: 'selected'; files: RawSelectedFile[]; rejections?: FileAcquisitionRejection[] }
  | { status: 'cancelled'; files: [] }
  | { status: 'unsupported'; files: []; message: string };

export interface AcquisitionOptions extends Partial<FileImportLimits> { maxDepth?: number }
interface AcquisitionState { count: number; bytes: number; rejections: FileAcquisitionRejection[] }
let acquisitionId = 0;
const nextAcquisitionId = () => `acquired-${Date.now().toString(36)}-${(++acquisitionId).toString(36)}`;

export async function acquireWithVisibleFailure(
  acquire: () => Promise<AcquisitionResult>,
  label: string,
): Promise<AcquisitionResult> {
  try {
    return await acquire();
  } catch (error) {
    return {
      status: 'selected',
      files: [],
      rejections: [{ path: label, reason: 'read-failed', message: error instanceof Error ? error.message : String(error) }],
    };
  }
}

const acquisitionLimits = (options: AcquisitionOptions = {}) => ({ ...FILE_IMPORT_LIMITS, maxDepth: 32, ...options });

function reserveAcquisition(path: string, size: number | undefined, state: AcquisitionState, limits: ReturnType<typeof acquisitionLimits>) {
  const reject = (reason: FileAcquisitionRejectionReason, message: string) => { state.rejections.push({ path, reason, message }); return false; };
  if (isHiddenOrSystem(path)) return reject('hidden-or-system', 'Hidden and system files are skipped.');
  const extension = extensionOf(path);
  if (!acceptedExtensions.has(extension) && extension !== '.zip') return reject('unsupported-extension', 'Unsupported file extension.');
  const byteLimit = extension === '.zip' ? limits.maxCompressedArchiveBytes : limits.maxCandidateBytes;
  if (size !== undefined && size > byteLimit) return reject(extension === '.zip' ? 'archive-too-large' : 'candidate-too-large', `File exceeds ${byteLimit} bytes.`);
  if (state.count >= limits.maxCandidates) return reject('candidate-limit-exceeded', `Selection is limited to ${limits.maxCandidates} candidates.`);
  state.count += 1;
  if (size !== undefined && state.bytes + size > limits.maxExpandedBytes) return reject('aggregate-limit-exceeded', `Selection exceeds ${limits.maxExpandedBytes} bytes.`);
  if (size !== undefined) state.bytes += size;
  return true;
}

function validateReadBytes(path: string, bytes: Uint8Array, declaredSize: number | undefined, state: AcquisitionState, limits: ReturnType<typeof acquisitionLimits>) {
  const byteLimit = extensionOf(path) === '.zip' ? limits.maxCompressedArchiveBytes : limits.maxCandidateBytes;
  if (bytes.length > byteLimit) { state.rejections.push({ path, reason: extensionOf(path) === '.zip' ? 'archive-too-large' : 'candidate-too-large', message: `File exceeds ${byteLimit} bytes.` }); return false; }
  const additional = Math.max(0, bytes.length - (declaredSize ?? 0));
  if (state.bytes + additional > limits.maxExpandedBytes) { state.rejections.push({ path, reason: 'aggregate-limit-exceeded', message: `Selection exceeds ${limits.maxExpandedBytes} bytes.` }); return false; }
  state.bytes += additional;
  return true;
}

async function readSelectedFile(file: File, path: string, state: AcquisitionState, limits: ReturnType<typeof acquisitionLimits>) {
  if (!reserveAcquisition(path, file.size, state, limits)) return null;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!validateReadBytes(path, bytes, file.size, state, limits)) return null;
    return { id: nextAcquisitionId(), name: file.name, relativePath: path, bytes };
  } catch (error) {
    state.rejections.push({ path, reason: 'read-failed', message: error instanceof Error ? error.message : 'Could not read file.' });
    return null;
  }
}

async function browserFiles(files: FileList | readonly File[], limits: ReturnType<typeof acquisitionLimits>, state: AcquisitionState): Promise<RawSelectedFile[]> {
  const output: RawSelectedFile[] = [];
  for (const file of Array.from(files)) {
    const path = ('webkitRelativePath' in file && file.webkitRelativePath) || file.name;
    const selected = await readSelectedFile(file, path, state, limits);
    if (selected) output.push(selected);
  }
  return output;
}

async function inputPicker(directory: boolean, owner: Document = document, options: AcquisitionOptions = {}): Promise<AcquisitionResult> {
  return new Promise((resolve) => {
    const input = owner.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.mib,.my,.txt,.asn1,.zip';
    if (directory) input.setAttribute('webkitdirectory', '');
    input.style.display = 'none';
    owner.body?.appendChild(input);
    let settled = false;
    let readingSelection = false;
    let focusTimer: ReturnType<typeof setTimeout> | undefined;
    const window = owner.defaultView;
    const clearFocusTimer = () => {
      if (focusTimer !== undefined) clearTimeout(focusTimer);
      focusTimer = undefined;
    };
    const cleanup = () => { clearFocusTimer(); input.removeEventListener('change', onSelection); input.removeEventListener('input', onSelection); input.removeEventListener('cancel', onCancel); window?.removeEventListener('focus', onFocus); input.remove(); };
    const finish = (result: AcquisitionResult) => { if (!settled) { settled = true; cleanup(); resolve(result); } };
    const onSelection = () => {
      if (settled || readingSelection) return;
      readingSelection = true;
      clearFocusTimer();
      const state: AcquisitionState = { count: 0, bytes: 0, rejections: [] };
      void browserFiles(input.files ?? [], acquisitionLimits(options), state).then((files) => finish(files.length || state.rejections.length ? { status: 'selected', files, ...(state.rejections.length ? { rejections: state.rejections } : {}) } : { status: 'cancelled', files: [] })).catch((error) => finish({ status: 'selected', files: [], rejections: [{ path: directory ? 'Folder picker' : 'File picker', reason: 'read-failed', message: error instanceof Error ? error.message : String(error) }] }));
    };
    const onCancel = () => finish({ status: 'cancelled', files: [] });
    const onFocus = () => {
      clearFocusTimer();
      focusTimer = setTimeout(() => {
        focusTimer = undefined;
        if (!settled && !readingSelection && !(input.files?.length)) onCancel();
      }, 1_000);
    };
    input.addEventListener('change', onSelection);
    input.addEventListener('input', onSelection);
    input.addEventListener('cancel', onCancel);
    window?.addEventListener('focus', onFocus);
    input.click();
  });
}

export const pickWebFiles = (owner?: Document, options?: AcquisitionOptions) => inputPicker(false, owner, options);
export const pickWebDirectory = (owner?: Document, options?: AcquisitionOptions) => inputPicker(true, owner, options);

interface LegacyEntry { isFile: boolean; isDirectory: boolean; name: string; file?: (ok: (file: File) => void, fail?: (error: unknown) => void) => void; createReader?: () => { readEntries: (ok: (entries: LegacyEntry[]) => void, fail?: (error: unknown) => void) => void } }

const legacyFile = (entry: LegacyEntry) => new Promise<File>((resolve, reject) => entry.file?.(resolve, reject));
const legacyEntries = (reader: ReturnType<NonNullable<LegacyEntry['createReader']>>) => new Promise<LegacyEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));

async function walkLegacy(entry: LegacyEntry, parent: string, output: RawSelectedFile[], state: AcquisitionState, limits: ReturnType<typeof acquisitionLimits>) {
  const path = parent ? `${parent}/${entry.name}` : entry.name;
  if (entry.isFile) {
    const file = await legacyFile(entry);
    const selected = await readSelectedFile(file, path, state, limits);
    if (selected) output.push(selected);
  } else if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader();
    for (;;) {
      const children = await legacyEntries(reader);
      if (children.length === 0) break;
      for (const child of children) await walkLegacy(child, path, output, state, limits);
    }
  }
}

type FsHandle = { kind: 'file' | 'directory'; name: string; getFile?: () => Promise<File>; values?: () => AsyncIterable<FsHandle> };
async function walkHandle(handle: FsHandle, parent: string, output: RawSelectedFile[], state: AcquisitionState, limits: ReturnType<typeof acquisitionLimits>) {
  const path = parent ? `${parent}/${handle.name}` : handle.name;
  if (handle.kind === 'file' && handle.getFile) {
    const file = await handle.getFile();
    const selected = await readSelectedFile(file, path, state, limits);
    if (selected) output.push(selected);
  } else if (handle.kind === 'directory' && handle.values) {
    for await (const child of handle.values()) await walkHandle(child, path, output, state, limits);
  }
}

export async function collectWebDataTransfer(dataTransfer: DataTransfer, options: AcquisitionOptions = {}): Promise<AcquisitionResult> {
  const output: RawSelectedFile[] = [];
  const state: AcquisitionState = { count: 0, bytes: 0, rejections: [] };
  const limits = acquisitionLimits(options);
  for (const item of Array.from(dataTransfer.items ?? [])) {
    const modern = (item as DataTransferItem & { getAsFileSystemHandle?: () => Promise<FsHandle | null> }).getAsFileSystemHandle;
    if (modern) { const handle = await modern.call(item); if (handle) await walkHandle(handle, '', output, state, limits); continue; }
    const legacy = (item as DataTransferItem & { webkitGetAsEntry?: () => LegacyEntry | null }).webkitGetAsEntry?.();
    if (legacy) { await walkLegacy(legacy, '', output, state, limits); continue; }
    const file = item.getAsFile?.();
    if (file) output.push(...await browserFiles([file], limits, state));
  }
  if (output.length === 0 && dataTransfer.files?.length) output.push(...await browserFiles(dataTransfer.files, limits, state));
  return output.length ? { status: 'selected', files: output, ...(state.rejections.length ? { rejections: state.rejections } : {}) } : state.rejections.length ? { status: 'selected', files: [], rejections: state.rejections } : { status: 'cancelled', files: [] };
}

export interface NativePickerDependencies {
  pick: () => Promise<{ canceled: boolean; assets: { name: string; uri: string; size?: number }[] }>;
  readBytes: (uri: string) => Promise<Uint8Array>;
}

export async function pickNativeFiles(dependencies: NativePickerDependencies, options: AcquisitionOptions = {}): Promise<AcquisitionResult> {
  const result = await dependencies.pick();
  if (result.canceled || result.assets.length === 0) return { status: 'cancelled', files: [] };
  const files: RawSelectedFile[] = [];
  const state: AcquisitionState = { count: 0, bytes: 0, rejections: [] };
  const limits = acquisitionLimits(options);
  for (const asset of result.assets) {
    if (!reserveAcquisition(asset.name, asset.size, state, limits)) continue;
    let bytes: Uint8Array;
    try { bytes = await dependencies.readBytes(asset.uri); }
    catch (error) { state.rejections.push({ path: asset.name, reason: 'read-failed', message: error instanceof Error ? error.message : 'Could not read file.' }); continue; }
    if (!validateReadBytes(asset.name, bytes, asset.size, state, limits)) continue;
    files.push({ id: nextAcquisitionId(), name: asset.name, relativePath: asset.name, bytes });
  }
  return { status: 'selected', files, ...(state.rejections.length ? { rejections: state.rejections } : {}) };
}

export interface NativeDirectoryDependencies {
  requestDirectory: () => Promise<string | null>;
  list: (uri: string) => Promise<{ uri: string; name: string; directory: boolean; size?: number }[]>;
  readBytes: (uri: string) => Promise<Uint8Array>;
}

export async function pickNativeDirectory(platform: 'android' | 'ios', dependencies: NativeDirectoryDependencies, options: AcquisitionOptions = {}): Promise<AcquisitionResult> {
  if (platform === 'ios') return { status: 'unsupported', files: [], message: 'Folder selection is unavailable on iOS. Choose multiple files or a ZIP archive instead.' };
  const root = await dependencies.requestDirectory();
  if (!root) return { status: 'cancelled', files: [] };
  const files: RawSelectedFile[] = [];
  const state: AcquisitionState = { count: 0, bytes: 0, rejections: [] };
  const limits = acquisitionLimits(options);
  const visited = new Set<string>();
  const walk = async (uri: string, parent: string, depth: number): Promise<void> => {
    if (visited.has(uri)) { state.rejections.push({ path: parent || uri, reason: 'directory-cycle', message: 'Directory was already visited.' }); return; }
    if (depth > limits.maxDepth) { state.rejections.push({ path: parent || uri, reason: 'directory-depth-exceeded', message: `Directory depth exceeds ${limits.maxDepth}.` }); return; }
    visited.add(uri);
    let entries: Awaited<ReturnType<NativeDirectoryDependencies['list']>>;
    try { entries = await dependencies.list(uri); }
    catch (error) { state.rejections.push({ path: parent || uri, reason: 'read-failed', message: error instanceof Error ? error.message : 'Could not list directory.' }); return; }
    for (const entry of entries) {
      const path = parent ? `${parent}/${entry.name}` : entry.name;
      if (isHiddenOrSystem(path)) { state.rejections.push({ path, reason: 'hidden-or-system', message: 'Hidden and system files are skipped.' }); continue; }
      if (entry.directory) await walk(entry.uri, path, depth + 1);
      else if (reserveAcquisition(path, entry.size, state, limits)) {
        let bytes: Uint8Array;
        try { bytes = await dependencies.readBytes(entry.uri); }
        catch (error) { state.rejections.push({ path, reason: 'read-failed', message: error instanceof Error ? error.message : 'Could not read file.' }); continue; }
        if (!validateReadBytes(path, bytes, entry.size, state, limits)) continue;
        files.push({ id: nextAcquisitionId(), name: entry.name, relativePath: path, bytes });
      }
    }
  };
  await walk(root, '', 0);
  return files.length || state.rejections.length ? { status: 'selected', files, ...(state.rejections.length ? { rejections: state.rejections } : {}) } : { status: 'cancelled', files: [] };
}
