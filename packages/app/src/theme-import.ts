import { unzipSync } from 'fflate';
import { THEME_PALETTES, type ThemeDescriptor, type ThemeScheme } from '@mibbeacon/ui/theme-values';
import {
  VSCODE_THEME_MAX_BYTES,
  createVscodeThemeDescriptor,
  parseVscodeThemeJsonc,
  resolveVscodeTheme,
  type VscodeColorTheme,
  type VscodeThemeResolver,
} from '@mibbeacon/ui/vscode-theme';

export const THEME_IMPORT_LIMITS = {
  maxArchiveBytes: 10 * 1024 * 1024,
  maxExpandedBytes: 25 * 1024 * 1024,
  maxEntries: 500,
  maxCompressionRatio: 100,
} as const;

export interface RawThemeImportFile {
  name: string;
  bytes: Uint8Array;
}

export interface PreparedThemeImport {
  themes: ThemeDescriptor[];
  warnings: string[];
  package?: {
    extensionId?: string;
    displayName?: string;
    version?: string;
    publisher?: string;
    license?: string;
  };
}

interface VsixManifest {
  name?: unknown;
  displayName?: unknown;
  publisher?: unknown;
  version?: unknown;
  license?: unknown;
  contributes?: {
    themes?: unknown;
  };
}

interface VsixThemeContribution {
  id?: unknown;
  label?: unknown;
  uiTheme?: unknown;
  path?: unknown;
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function safePath(path: string): string {
  if (
    !path ||
    path.includes('\0') ||
    path.includes('\\') ||
    path.startsWith('/') ||
    /^[a-z]:/i.test(path)
  ) {
    throw new Error(`Unsafe archive path: ${path || '(empty)'}.`);
  }
  const output: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!output.length) throw new Error(`Unsafe archive path: ${path}.`);
      output.pop();
    } else {
      output.push(part);
    }
  }
  if (!output.length) throw new Error(`Unsafe archive path: ${path}.`);
  return output.join('/');
}

function relativePath(path: string, fromPath?: string): string {
  const base = fromPath?.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/') + 1) : '';
  return safePath(`${base}${path.replace(/^\.\//, '')}`);
}

function stableId(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function text(value: unknown, max = 160): string | undefined {
  return typeof value === 'string' && value.trim() && value.length <= max
    ? value.trim()
    : undefined;
}

function uiTheme(value: unknown): 'vs' | 'vs-dark' | 'hc-black' | 'hc-light' | undefined {
  return value === 'vs' || value === 'vs-dark' || value === 'hc-black' || value === 'hc-light'
    ? value
    : undefined;
}

function schemeFor(
  document: VscodeColorTheme,
  resolver?: VscodeThemeResolver,
  path?: string,
  contributionUiTheme?: ReturnType<typeof uiTheme>,
): ThemeScheme {
  return resolveVscodeTheme(document, resolver, contributionUiTheme, path).scheme;
}

function themeDescriptor(
  document: VscodeColorTheme,
  resolver: VscodeThemeResolver | undefined,
  path: string | undefined,
  idSeed: string,
  label: string | undefined,
  contributionUiTheme: ReturnType<typeof uiTheme>,
  provenance: NonNullable<ThemeDescriptor['provenance']>,
): { descriptor: ThemeDescriptor; warnings: string[] } {
  const scheme = schemeFor(document, resolver, path, contributionUiTheme);
  const result = createVscodeThemeDescriptor(document, resolver, {
    id: `imported-${stableId(idSeed)}`,
    label,
    source: 'imported',
    uiTheme: contributionUiTheme,
    path,
    fallback: THEME_PALETTES[scheme],
  });
  return {
    descriptor: {
      id: result.id,
      label: result.label,
      scheme: result.scheme,
      source: result.source,
      highContrast: result.highContrast,
      palette: result.palette,
      provenance,
    },
    warnings: result.warnings,
  };
}

export function importVscodeThemeJsonFiles(
  files: readonly RawThemeImportFile[],
): PreparedThemeImport {
  if (!files.length) return { themes: [], warnings: [] };
  const documents = new Map<string, VscodeColorTheme>();
  const sources = new Map<string, string>();
  const warnings: string[] = [];
  for (const file of files) {
    if (file.bytes.byteLength > VSCODE_THEME_MAX_BYTES) {
      throw new Error(`${file.name} exceeds the ${VSCODE_THEME_MAX_BYTES}-byte safety limit.`);
    }
    const path = safePath(file.name);
    const source = decode(file.bytes);
    const parsed = parseVscodeThemeJsonc(source);
    documents.set(path, parsed.document);
    sources.set(path, source);
    warnings.push(...parsed.warnings.map((warning) => `${file.name}: ${warning}`));
  }
  const resolver: VscodeThemeResolver = {
    canonicalize: relativePath,
    load: (path) => documents.get(safePath(path)),
  };
  const referenced = new Set<string>();
  for (const [path, document] of documents) {
    if (document.include) referenced.add(relativePath(document.include, path));
  }
  const roots = [...documents].filter(([path]) => !referenced.has(path));
  const entries = roots.length ? roots : [...documents];
  const importedAt = new Date().toISOString();
  const themes: ThemeDescriptor[] = [];
  for (const [path, document] of entries) {
    const prepared = themeDescriptor(
      document,
      resolver,
      path,
      `${path}\0${sources.get(path) ?? ''}`,
      document.name,
      undefined,
      {
        kind: 'json',
        fileName: path,
        importedAt,
      },
    );
    themes.push(prepared.descriptor);
    warnings.push(...prepared.warnings.map((warning) => `${path}: ${warning}`));
  }
  return {
    themes,
    warnings: [...new Set(warnings)],
  };
}

export function importVscodeThemeJson(file: RawThemeImportFile): PreparedThemeImport {
  return importVscodeThemeJsonFiles([file]);
}

function preflightVsixArchive(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minimumEocdBytes = 22;
  const maximumCommentBytes = 0xffff;
  let eocdOffset = -1;
  for (
    let offset = bytes.byteLength - minimumEocdBytes;
    offset >= Math.max(0, bytes.byteLength - minimumEocdBytes - maximumCommentBytes);
    offset -= 1
  ) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error('Invalid VSIX ZIP directory.');

  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralBytes = view.getUint32(eocdOffset + 12, true);
  const centralOffset = view.getUint32(eocdOffset + 16, true);
  if (entryCount === 0xffff || centralBytes === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error('ZIP64 VSIX archives are not supported.');
  }
  if (entryCount > THEME_IMPORT_LIMITS.maxEntries) {
    throw new Error(`VSIX contains more than ${THEME_IMPORT_LIMITS.maxEntries} entries.`);
  }
  if (centralOffset + centralBytes > eocdOffset) {
    throw new Error('Invalid VSIX ZIP directory bounds.');
  }

  let offset = centralOffset;
  let expandedBytes = 0;
  let compressedBytes = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > eocdOffset || view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error('Invalid VSIX ZIP directory entry.');
    }
    const flags = view.getUint16(offset + 8, true);
    if ((flags & 0x1) !== 0) throw new Error('Encrypted VSIX entries are not supported.');
    const compressedSize = view.getUint32(offset + 20, true);
    const expandedSize = view.getUint32(offset + 24, true);
    const nameBytes = view.getUint16(offset + 28, true);
    const extraBytes = view.getUint16(offset + 30, true);
    const commentBytes = view.getUint16(offset + 32, true);
    if (compressedSize === 0xffffffff || expandedSize === 0xffffffff) {
      throw new Error('ZIP64 VSIX entries are not supported.');
    }
    const nextOffset = offset + 46 + nameBytes + extraBytes + commentBytes;
    if (nextOffset > eocdOffset) throw new Error('Invalid VSIX ZIP directory entry bounds.');
    safePath(decode(bytes.subarray(offset + 46, offset + 46 + nameBytes)));
    expandedBytes += expandedSize;
    compressedBytes += compressedSize;
    if (expandedBytes > THEME_IMPORT_LIMITS.maxExpandedBytes) {
      throw new Error('VSIX expanded data exceeds the safety limit.');
    }
    offset = nextOffset;
  }
  if (offset !== centralOffset + centralBytes) {
    throw new Error('Invalid VSIX ZIP directory size.');
  }
  if (
    expandedBytes > 0 &&
    expandedBytes / Math.max(1, compressedBytes) > THEME_IMPORT_LIMITS.maxCompressionRatio
  ) {
    throw new Error('VSIX compression ratio exceeds the safety limit.');
  }
}

export function importVscodeThemeVsix(file: RawThemeImportFile): PreparedThemeImport {
  if (file.bytes.byteLength > THEME_IMPORT_LIMITS.maxArchiveBytes) {
    throw new Error(`VSIX exceeds the ${THEME_IMPORT_LIMITS.maxArchiveBytes}-byte safety limit.`);
  }
  preflightVsixArchive(file.bytes);
  let archive: Record<string, Uint8Array>;
  try {
    archive = unzipSync(file.bytes);
  } catch (cause) {
    throw new Error(
      `Invalid or unsupported VSIX archive: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  const entries = Object.entries(archive);
  if (entries.length > THEME_IMPORT_LIMITS.maxEntries) {
    throw new Error(`VSIX contains more than ${THEME_IMPORT_LIMITS.maxEntries} entries.`);
  }
  let expandedBytes = 0;
  const files = new Map<string, Uint8Array>();
  for (const [rawPath, bytes] of entries) {
    const path = safePath(rawPath);
    expandedBytes += bytes.byteLength;
    if (expandedBytes > THEME_IMPORT_LIMITS.maxExpandedBytes) {
      throw new Error('VSIX expanded data exceeds the safety limit.');
    }
    files.set(path, bytes);
  }
  if (
    file.bytes.byteLength > 0 &&
    expandedBytes / file.bytes.byteLength > THEME_IMPORT_LIMITS.maxCompressionRatio
  ) {
    throw new Error('VSIX compression ratio exceeds the safety limit.');
  }

  const manifestPath = files.has('extension/package.json')
    ? 'extension/package.json'
    : files.has('package.json')
      ? 'package.json'
      : undefined;
  if (!manifestPath) throw new Error('VSIX does not contain an extension package.json.');
  const manifestBytes = files.get(manifestPath)!;
  if (manifestBytes.byteLength > 512 * 1024) throw new Error('VSIX package.json is too large.');

  let manifest: VsixManifest;
  try {
    manifest = JSON.parse(decode(manifestBytes)) as VsixManifest;
  } catch {
    throw new Error('VSIX package.json is not valid JSON.');
  }
  const contributions = manifest.contributes?.themes;
  if (!Array.isArray(contributions) || contributions.length === 0) {
    throw new Error('VSIX contains no color theme contributions.');
  }
  if (contributions.length > 50) throw new Error('VSIX contributes too many color themes.');

  const extensionRoot = manifestPath.slice(0, manifestPath.length - 'package.json'.length);
  const documents = new Map<string, VscodeColorTheme>();
  const parseWarnings: string[] = [];
  for (const [path, bytes] of files) {
    if (!/\.jsonc?$/i.test(path) || bytes.byteLength > VSCODE_THEME_MAX_BYTES) continue;
    try {
      const parsed = parseVscodeThemeJsonc(decode(bytes));
      documents.set(path, parsed.document);
      parseWarnings.push(...parsed.warnings.map((warning) => `${path}: ${warning}`));
    } catch {
      // Non-theme JSON files are deliberately ignored.
    }
  }
  const resolver: VscodeThemeResolver = {
    canonicalize: relativePath,
    load: (path) => documents.get(safePath(path)),
  };

  const publisher = text(manifest.publisher);
  const packageName = text(manifest.name);
  const version = text(manifest.version);
  const license = text(manifest.license);
  const extensionId = publisher && packageName ? `${publisher}.${packageName}` : packageName;
  const importedAt = new Date().toISOString();
  const themes: ThemeDescriptor[] = [];
  const warnings = [...parseWarnings];

  for (const rawContribution of contributions as VsixThemeContribution[]) {
    if (!rawContribution || typeof rawContribution !== 'object') {
      warnings.push('Ignored an invalid theme contribution.');
      continue;
    }
    const contributedPath = text(rawContribution.path, 500);
    if (!contributedPath) {
      warnings.push('Ignored a theme contribution without a valid path.');
      continue;
    }
    const path = relativePath(contributedPath, `${extensionRoot}package.json`);
    const document = documents.get(path);
    if (!document) {
      warnings.push(`Theme contribution ${contributedPath} is missing or invalid.`);
      continue;
    }
    const label = text(rawContribution.label) ?? text(rawContribution.id) ?? document.name;
    const prepared = themeDescriptor(
      document,
      resolver,
      path,
      `${extensionId ?? file.name}\0${version ?? ''}\0${path}`,
      label,
      uiTheme(rawContribution.uiTheme),
      {
        kind: 'vsix',
        fileName: file.name,
        extensionId,
        version,
        publisher,
        license,
        importedAt,
      },
    );
    themes.push(prepared.descriptor);
    warnings.push(...prepared.warnings.map((warning) => `${label ?? path}: ${warning}`));
  }
  if (!themes.length) throw new Error('VSIX has no usable color themes.');
  if (!license) warnings.push('The extension does not declare a license.');

  return {
    themes,
    warnings: [...new Set(warnings)],
    package: {
      extensionId,
      displayName: text(manifest.displayName),
      version,
      publisher,
      license,
    },
  };
}

export function prepareThemeImport(file: RawThemeImportFile): PreparedThemeImport {
  const extension = file.name.toLowerCase().split('.').pop();
  if (extension === 'vsix') return importVscodeThemeVsix(file);
  if (extension === 'json' || extension === 'jsonc') return importVscodeThemeJson(file);
  throw new Error('Choose a VS Code .json, .jsonc, or theme-only .vsix file.');
}

export function prepareThemeImports(files: readonly RawThemeImportFile[]): PreparedThemeImport {
  const jsonFiles: RawThemeImportFile[] = [];
  const themes: ThemeDescriptor[] = [];
  const warnings: string[] = [];
  for (const file of files) {
    const extension = file.name.toLowerCase().split('.').pop();
    if (extension === 'json' || extension === 'jsonc') {
      jsonFiles.push(file);
      continue;
    }
    const imported = prepareThemeImport(file);
    themes.push(...imported.themes);
    warnings.push(...imported.warnings);
  }
  if (jsonFiles.length) {
    const imported = importVscodeThemeJsonFiles(jsonFiles);
    themes.push(...imported.themes);
    warnings.push(...imported.warnings);
  }
  return { themes, warnings: [...new Set(warnings)] };
}
