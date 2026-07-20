import { describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import {
  buildFileImportReview,
  createInitialFileSelection,
  validateFileImportSelection,
  collectWebDataTransfer,
  decodeMibBytes,
  pickNativeDirectory,
  pickNativeFiles,
  pickWebFiles,
  prepareFileImport,
  retainedFileReviewAction,
  stageAcquiredFileImport,
  type RawSelectedFile,
} from './file-import';

const mib = (name = 'TEST-MIB') => `${name} DEFINITIONS ::= BEGIN\nroot OBJECT IDENTIFIER ::= { iso 3 }\nEND`;
const raw = (name: string, bytes: Uint8Array | string, relativePath?: string): RawSelectedFile => ({
  name,
  bytes: typeof bytes === 'string' ? strToU8(bytes) : bytes,
  relativePath,
});

describe('decodeMibBytes', () => {
  it('removes a UTF-8 BOM and reports UTF-8', async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...strToU8(mib())]);
    expect(decodeMibBytes(bytes)).toEqual({ text: mib(), encoding: 'utf-8' });
  });

  it('falls back to Latin-1 only when strict UTF-8 decoding fails', async () => {
    const bytes = new Uint8Array([...strToU8(mib()), 0x20, 0xe9]);
    expect(decodeMibBytes(bytes)).toEqual({ text: `${mib()} é`, encoding: 'latin1' });
  });
});

describe('prepareFileImport', () => {
  it('accepts supported and extensionless SMI files and rejects non-SMI content', async () => {
    const result = await prepareFileImport([
      raw('one.mib', mib('ONE-MIB')),
      raw('two', mib('TWO-MIB')),
      raw('three.smi', mib('THREE-MIB')),
      raw('three.json', mib('THREE-MIB')),
      raw('page.txt', '<html>not a mib</html>'),
    ]);
    expect(result.candidates.map((item) => item.path)).toEqual(['one.mib', 'two', 'three.smi']);
    expect(result.rejections.map((item) => item.reason)).toEqual(['unsupported-extension', 'html-content']);
  });

  it('skips hidden and system paths before reading them as candidates', async () => {
    const result = await prepareFileImport([
      raw('.hidden.mib', mib()),
      raw('thing.mib', mib(), 'folder/.private/thing.mib'),
      raw('Thumbs.db', mib()),
      raw('good.mib', mib(), 'folder/good.mib'),
    ]);
    expect(result.candidates.map((item) => item.path)).toEqual(['folder/good.mib']);
    expect(result.rejections.every((item) => item.reason === 'hidden-or-system')).toBe(true);
  });

  it('expands ZIP entries and preserves archive-attributed paths without expanding nested ZIPs', async () => {
    const nested = zipSync({ 'nested.mib': strToU8(mib('NESTED-MIB')) });
    const archive = zipSync({ 'deps/one.mib': strToU8(mib('ONE-MIB')), 'nested.zip': nested });
    const result = await prepareFileImport([raw('bundle.zip', archive)]);
    expect(result.candidates.map((item) => item.path)).toEqual(['bundle.zip/deps/one.mib']);
    expect(result.rejections).toContainEqual(expect.objectContaining({ path: 'bundle.zip/nested.zip', reason: 'nested-archive' }));
  });

  it('rejects traversal and absolute ZIP paths', async () => {
    const archive = zipSync({ '../outside.mib': strToU8(mib()), '/absolute.mib': strToU8(mib()), 'safe.mib': strToU8(mib()) });
    const result = await prepareFileImport([raw('bad.zip', archive)]);
    expect(result.candidates.map((item) => item.path)).toEqual(['bad.zip/safe.mib']);
    expect(result.rejections.filter((item) => item.reason === 'unsafe-path')).toHaveLength(2);
  });

  it('rejects encrypted ZIP archives before extraction', async () => {
    const archive = zipSync({ 'one.mib': strToU8(mib()) });
    archive[6] = (archive[6] ?? 0) | 1;
    for (let index = 0; index < archive.length - 10; index += 1) {
      if (archive[index] === 0x50 && archive[index + 1] === 0x4b && archive[index + 2] === 0x01 && archive[index + 3] === 0x02) {
        archive[index + 8] = (archive[index + 8] ?? 0) | 1;
      }
    }
    const result = await prepareFileImport([raw('encrypted.zip', archive)]);
    expect(result.candidates).toHaveLength(0);
    expect(result.rejections).toContainEqual(expect.objectContaining({ reason: 'encrypted-archive' }));
  });

  it('hard-rejects an archive whose entry count exceeds the limit without partial acceptance', async () => {
    const archive = zipSync(Object.fromEntries(Array.from({ length: 4 }, (_, index) => [`${index}.mib`, strToU8(mib(`M${index}-MIB`))])));
    const result = await prepareFileImport([raw('many.zip', archive)], { maxCandidates: 3 });
    expect(result.candidates).toHaveLength(0);
    expect(result.rejections).toEqual([expect.objectContaining({ path: 'many.zip', reason: 'candidate-limit-exceeded' })]);
  });

  it('enforces per-file, compressed, expanded, count, and compression-ratio limits', async () => {
    const archive = zipSync({ 'huge.mib': strToU8(mib() + ' '.repeat(2000)) }, { level: 9 });
    const result = await prepareFileImport(
      [raw('large.mib', mib() + ' '.repeat(100)), raw('bomb.zip', archive), raw('extra.mib', mib())],
      { maxCandidateBytes: 100, maxCompressedArchiveBytes: 10_000, maxExpandedBytes: 1000, maxCandidates: 2, maxCompressionRatio: 2 },
    );
    expect(result.rejections.map((item) => item.reason)).toEqual(expect.arrayContaining(['candidate-too-large', 'compression-ratio-exceeded', 'candidate-limit-exceeded']));
  });

  it('rejects binary data', async () => {
    const result = await prepareFileImport([raw('binary.mib', new Uint8Array([0, 1, 2, 3]))]);
    expect(result.rejections[0]?.reason).toBe('binary-content');
  });
});

describe('local file import review', () => {
  const document = (name: string, body = '') => `${name} DEFINITIONS ::= BEGIN\n${body}\nEND`;

  it('extracts declarations/imports and classifies missing dependencies without an engine call', async () => {
    const prepared = await prepareFileImport([raw('vendor/CHILD-MIB.mib', document('CHILD-MIB', `
      IMPORTS ifIndex FROM IF-MIB, localThing FROM PARENT-MIB;
      child OBJECT IDENTIFIER ::= { localThing 1 }
    `), 'vendor/CHILD-MIB.mib'), raw('PARENT-MIB.mib', document('PARENT-MIB'))]);
    const review = buildFileImportReview(prepared, [], [
      { name: 'SNMPv2-SMI', objectCount: 10, isBase: true },
      { name: 'IF-MIB', objectCount: 20, isBase: false },
    ], new Map());
    expect(review.files[0]).toEqual(expect.objectContaining({
      path: 'vendor/CHILD-MIB.mib',
      modules: ['CHILD-MIB'],
      imports: expect.arrayContaining([
        { module: 'IF-MIB', symbols: ['ifIndex'], external: false },
        { module: 'PARENT-MIB', symbols: ['localThing'], external: false },
      ]),
    }));
    expect(review.externalMissingImports).toEqual([]);
  });

  it('blocks base collisions and skips loaded-user collisions by default', async () => {
    const prepared = await prepareFileImport([raw('base.mib', document('BASE-MIB')), raw('user.mib', document('USER-MIB'))]);
    const review = buildFileImportReview(prepared, [], [
      { name: 'BASE-MIB', objectCount: 1, isBase: true },
      { name: 'USER-MIB', objectCount: 1, isBase: false },
    ], new Map([['USER-MIB', ['USER-MIB', 'PEER-MIB']]]));
    const initial = createInitialFileSelection(review);
    expect(initial.size).toBe(0);
    expect(review.files[0]?.blocked).toBe(true);
    expect(review.files[1]?.collisions[0]?.replacementGroup).toEqual(['USER-MIB', 'PEER-MIB']);
  });

  it('requires one selected owner for duplicate modules and keeps multi-module files atomic', async () => {
    const prepared = await prepareFileImport([
      raw('bundle.mib', `${document('ONE-MIB')}\n${document('TWO-MIB')}`),
      raw('other.mib', document('ONE-MIB')),
    ]);
    const review = buildFileImportReview(prepared, [], [], new Map());
    expect(createInitialFileSelection(review)).toEqual(new Set());
    expect(validateFileImportSelection(review, new Set(), new Set()).errors[0]).toContain('ONE-MIB');
    const result = validateFileImportSelection(review, new Set([review.files[0]!.id]), new Set());
    expect(result.errors).toEqual([]);
    expect(result.files.map((file) => file.relativePath)).toEqual(['bundle.mib']);
    expect(result.files[0]?.content).toContain('TWO-MIB');
  });

  it('enforces complete replacement groups before producing an import request', async () => {
    const prepared = await prepareFileImport([raw('one.mib', document('ONE-MIB'))]);
    const review = buildFileImportReview(prepared, [], [
      { name: 'ONE-MIB', objectCount: 1, isBase: false },
      { name: 'TWO-MIB', objectCount: 1, isBase: false },
    ], new Map([['ONE-MIB', ['ONE-MIB', 'TWO-MIB']]]));
    const key = 'ONE-MIB|TWO-MIB';
    const invalid = validateFileImportSelection(review, new Set([review.files[0]!.id]), new Set([key]));
    expect(invalid.errors).toContain('Replacement must provide every module in the original source: ONE-MIB, TWO-MIB.');
    expect(invalid.files).toEqual([]);
  });

  it('keeps acquisition and content rejections attributable in the review', async () => {
    const prepared = await prepareFileImport([raw('bad.txt', '<html>bad</html>')]);
    const review = buildFileImportReview(prepared, [{ path: 'secret/.hidden.mib', reason: 'hidden-or-system', message: 'Hidden file.' }], [], new Map());
    expect(review.rejections.map((item) => item.path)).toEqual(['bad.txt', 'secret/.hidden.mib']);
  });

  it('stages locally and sends only module-name metadata before confirmation', async () => {
    const calls: unknown[][] = [];
    const review = await stageAcquiredFileImport(
      { status: 'selected', files: [raw('one.mib', document('ONE-MIB'))] },
      [{ name: 'ONE-MIB', objectCount: 1, isBase: false }],
      async (...args) => { calls.push(args); return ['ONE-MIB']; },
    );
    expect(calls).toEqual([['ONE-MIB']]);
    expect(JSON.stringify(calls)).not.toContain('DEFINITIONS');
    expect(review.files[0]?.candidate.text).toContain('DEFINITIONS');
  });

  it('retains a staged snapshot until success and reopens it after non-success terminals', async () => {
    expect(retainedFileReviewAction('one', { handleId: 'other', state: 'error' })).toBe('wait');
    expect(retainedFileReviewAction('one', { handleId: 'one', state: 'resolving' })).toBe('wait');
    expect(retainedFileReviewAction('one', { handleId: 'one', state: 'done' })).toBe('discard');
    for (const state of ['partial', 'error', 'cancelled', 'expired']) {
      expect(retainedFileReviewAction('one', { handleId: 'one', state })).toBe('reopen');
    }
  });

  it('blocks dependency imports until automatic resolution is available', async () => {
    const fileImportModule = (await import('./file-import')) as unknown as Record<string, unknown>;
    expect(fileImportModule.dependencyResolverGate).toBeTypeOf('function');
    const dependencyResolverGate = fileImportModule.dependencyResolverGate as (
      missingCount: number,
      settings: { enabled: boolean; autoResolveImports: boolean } | null,
    ) => { blocked: boolean; message: string | null };

    expect(dependencyResolverGate(0, null)).toEqual({ blocked: false, message: null });
    expect(dependencyResolverGate(1, null)).toEqual({
      blocked: true,
      message: 'Checking dependency resolver settings…',
    });
    expect(
      dependencyResolverGate(1, { enabled: true, autoResolveImports: false }),
    ).toEqual({
      blocked: true,
      message: 'Automatic dependency resolution is off.',
    });
    expect(
      dependencyResolverGate(1, { enabled: true, autoResolveImports: true }),
    ).toEqual({ blocked: false, message: null });
  });

  it('recomputes missing dependencies from the selected file subset', async () => {
    const prepared = await prepareFileImport([
      raw(
        'child.mib',
        document(
          'CHILD-MIB',
          'IMPORTS localRoot FROM PROVIDER-MIB, remoteRoot FROM REMOTE-MIB;\nchildRoot OBJECT IDENTIFIER ::= { localRoot 1 }',
        ),
      ),
      raw('provider.mib', document('PROVIDER-MIB', 'localRoot OBJECT IDENTIFIER ::= { iso 3 }')),
    ]);
    const review = buildFileImportReview(prepared, [], [], new Map());
    const fileImportModule = (await import('./file-import')) as unknown as Record<string, unknown>;
    expect(fileImportModule.selectedExternalMissingImports).toBeTypeOf('function');
    const selectedExternalMissingImports = fileImportModule.selectedExternalMissingImports as (
      review: typeof review,
      selected: ReadonlySet<string>,
    ) => { module: string }[];
    const child = review.files.find((file) => file.modules.includes('CHILD-MIB'))!;
    const provider = review.files.find((file) => file.modules.includes('PROVIDER-MIB'))!;

    expect(selectedExternalMissingImports(review, new Set([provider.id]))).toEqual([]);
    expect(
      selectedExternalMissingImports(review, new Set([child.id, provider.id])).map(
        (item) => item.module,
      ),
    ).toEqual(['REMOTE-MIB']);
    expect(
      selectedExternalMissingImports(review, new Set([child.id])).map((item) => item.module),
    ).toEqual(['PROVIDER-MIB', 'REMOTE-MIB']);
  });

  it('focuses the review heading without using native node handles on web', async () => {
    const fileImportModule = (await import('./file-import')) as unknown as Record<string, unknown>;
    expect(fileImportModule.focusFileImportReviewHeading).toBeTypeOf('function');
    const focusFileImportReviewHeading = fileImportModule.focusFileImportReviewHeading as (
      platform: string,
      target: { focus(): void },
      focusNative: () => void,
    ) => void;
    const focus = vi.fn();
    const focusNative = vi.fn();

    focusFileImportReviewHeading('web', { focus }, focusNative);

    expect(focus).toHaveBeenCalledOnce();
    expect(focusNative).not.toHaveBeenCalled();
  });
});

describe('platform adapters', () => {
  it('treats native picker cancellation as an empty result and reads bytes', async () => {
    const cancelled = await pickNativeFiles({ pick: async () => ({ canceled: true, assets: [] }), readBytes: async () => new Uint8Array() });
    expect(cancelled).toEqual({ status: 'cancelled', files: [] });
    const selected = await pickNativeFiles({
      pick: async () => ({ canceled: false, assets: [{ name: 'one.mib', uri: 'file://one' }] }),
      readBytes: async () => strToU8(mib()),
    });
    expect(selected.status).toBe('selected');
    expect(selected.files[0]?.bytes).toEqual(strToU8(mib()));
  });

  it('prefilters native selections and stops at count/aggregate limits before reading bytes', async () => {
    const reads: string[] = [];
    const result = await pickNativeFiles({
      pick: async () => ({ canceled: false, assets: [
        { name: '.hidden.mib', uri: 'hidden', size: 1 },
        { name: 'bad.json', uri: 'bad', size: 1 },
        { name: 'large.mib', uri: 'large', size: 101 },
        { name: 'one.mib', uri: 'one', size: 60 },
        { name: 'two.mib', uri: 'two', size: 60 },
        { name: 'three.mib', uri: 'three', size: 1 },
      ] }),
      readBytes: async (uri) => { reads.push(uri); return new Uint8Array(uri === 'one' || uri === 'two' ? 60 : 1); },
    }, { maxCandidateBytes: 100, maxExpandedBytes: 100, maxCandidates: 2 });
    expect(reads).toEqual(['one']);
    expect(result.files.map((file) => file.name)).toEqual(['one.mib']);
    expect(result.rejections?.map((item) => item.reason)).toEqual(expect.arrayContaining([
      'hidden-or-system', 'unsupported-extension', 'candidate-too-large', 'aggregate-limit-exceeded', 'candidate-limit-exceeded',
    ]));
  });

  it('rejects an unknown-size native file when its read bytes exceed the per-file limit', async () => {
    const result = await pickNativeFiles({
      pick: async () => ({ canceled: false, assets: [{ name: 'large.mib', uri: 'large' }] }),
      readBytes: async () => new Uint8Array(101),
    }, { maxCandidateBytes: 100 });
    expect(result.files).toHaveLength(0);
    expect(result.rejections).toContainEqual(expect.objectContaining({ reason: 'candidate-too-large' }));
  });

  it('keeps prior native selections when a later byte read fails', async () => {
    const result = await pickNativeFiles({
      pick: async () => ({ canceled: false, assets: [{ name: 'one.mib', uri: 'one', size: 1 }, { name: 'bad.mib', uri: 'bad', size: 1 }] }),
      readBytes: async (uri) => { if (uri === 'bad') throw new Error('denied'); return new Uint8Array(1); },
    });
    expect(result.files.map((file) => file.name)).toEqual(['one.mib']);
    expect(result.rejections).toContainEqual(expect.objectContaining({ path: 'bad.mib', reason: 'read-failed' }));
  });

  it('reports iOS folder selection as unsupported with a ZIP/multi-file fallback', async () => {
    const result = await pickNativeDirectory('ios', { requestDirectory: async () => null, list: async () => [], readBytes: async () => new Uint8Array() });
    expect(result).toEqual({ status: 'unsupported', files: [], message: expect.stringContaining('ZIP') });
  });

  it('recursively collects Android SAF directories', async () => {
    const result = await pickNativeDirectory('android', {
      requestDirectory: async () => 'content://root',
      list: async (uri) => uri === 'content://root' ? [
        { uri: 'content://root/sub', name: 'sub', directory: true },
        { uri: 'content://root/one.mib', name: 'one.mib', directory: false },
      ] : [{ uri: 'content://root/sub/two.mib', name: 'two.mib', directory: false }],
      readBytes: async () => strToU8(mib()),
    });
    expect(result.files.map((file) => file.relativePath)).toEqual(['sub/two.mib', 'one.mib']);
  });

  it('bounds Android SAF traversal and never follows a visited directory twice', async () => {
    const reads: string[] = [];
    const result = await pickNativeDirectory('android', {
      requestDirectory: async () => 'content://root',
      list: async (uri) => uri === 'content://root'
        ? [{ uri: 'content://root', name: 'cycle', directory: true }, { uri: 'content://deep', name: 'deep', directory: true }]
        : uri === 'content://deep'
          ? [{ uri: 'content://deeper', name: 'deeper', directory: true }]
          : [{ uri: `${uri}/one.mib`, name: 'one.mib', directory: false, size: 1 }],
      readBytes: async (uri) => { reads.push(uri); return strToU8(mib()); },
    }, { maxDepth: 1 });
    expect(reads).toEqual([]);
    expect(result.rejections?.map((item) => item.reason)).toEqual(expect.arrayContaining(['directory-cycle', 'directory-depth-exceeded']));
  });

  it('recursively collects legacy drag/drop file-system entries', async () => {
    const file = { name: 'one.mib', arrayBuffer: async () => strToU8(mib()).buffer } as File;
    const fileEntry = { isFile: true, isDirectory: false, name: 'one.mib', file: (ok: (file: File) => void) => ok(file) };
    let read = false;
    const directory = { isFile: false, isDirectory: true, name: 'folder', createReader: () => ({ readEntries: (ok: (entries: unknown[]) => void) => { ok(read ? [] : [fileEntry]); read = true; } }) };
    const result = await collectWebDataTransfer({ items: [{ webkitGetAsEntry: () => directory }] } as unknown as DataTransfer);
    expect(result.files[0]?.relativePath).toBe('folder/one.mib');
  });

  it('prefilters dropped entries before byte reads and stops at candidate limits', async () => {
    let reads = 0;
    const makeFileEntry = (name: string) => ({
      isFile: true, isDirectory: false, name,
      file: (ok: (file: File) => void) => ok({ name, size: 1, arrayBuffer: async () => { reads += 1; return strToU8(mib()).buffer; } } as File),
    });
    const result = await collectWebDataTransfer({ items: [makeFileEntry('.hidden.mib'), makeFileEntry('bad.json'), makeFileEntry('one.mib'), makeFileEntry('two.mib')].map((entry) => ({ webkitGetAsEntry: () => entry })) } as unknown as DataTransfer, { maxCandidates: 1 });
    expect(reads).toBe(1);
    expect(result.files.map((file) => file.name)).toEqual(['one.mib']);
  });

  it('resolves web picker cancellation on focus return and removes its temporary input', async () => {
    vi.useFakeTimers();
    const listeners = new Map<string, () => void>();
    const inputListeners = new Map<string, () => void>();
    let removed = false;
    const input = {
      type: '', multiple: false, accept: '', files: null,
      style: {}, setAttribute: () => undefined,
      addEventListener: (name: string, callback: () => void) => inputListeners.set(name, callback),
      removeEventListener: (name: string) => inputListeners.delete(name),
      click: () => listeners.get('focus')?.(),
      remove: () => { removed = true; },
    };
    const owner = {
      createElement: () => input,
      body: { appendChild: () => undefined },
      defaultView: {
        addEventListener: (name: string, callback: () => void) => listeners.set(name, callback),
        removeEventListener: (name: string) => listeners.delete(name),
      },
    } as unknown as Document;
    const result = pickWebFiles(owner);
    await vi.runAllTimersAsync();
    await expect(result).resolves.toEqual({ status: 'cancelled', files: [] });
    expect(removed).toBe(true);
    expect(listeners.size).toBe(0);
    expect(inputListeners.size).toBe(0);
    vi.useRealTimers();
  });

  it('waits for Android Chrome to deliver a selection after window focus returns', async () => {
    vi.useFakeTimers();
    const listeners = new Map<string, () => void>();
    const inputListeners = new Map<string, () => void>();
    const file = {
      name: 'DOCS-IF-MIB.txt',
      size: mib('DOCS-IF-MIB').length,
      arrayBuffer: async () => strToU8(mib('DOCS-IF-MIB')).buffer,
    } as File;
    const input = {
      type: '', multiple: false, accept: '', files: null as File[] | null,
      style: {}, setAttribute: () => undefined,
      addEventListener: (name: string, callback: () => void) => inputListeners.set(name, callback),
      removeEventListener: (name: string) => inputListeners.delete(name),
      click: () => listeners.get('focus')?.(),
      remove: () => undefined,
    };
    const owner = {
      createElement: () => input,
      body: { appendChild: () => undefined },
      defaultView: {
        addEventListener: (name: string, callback: () => void) => listeners.set(name, callback),
        removeEventListener: (name: string) => listeners.delete(name),
      },
    } as unknown as Document;

    const result = pickWebFiles(owner);
    await vi.advanceTimersByTimeAsync(50);
    input.files = [file];
    inputListeners.get('change')?.();

    await expect(result).resolves.toMatchObject({
      status: 'selected',
      files: [{ name: 'DOCS-IF-MIB.txt' }],
    });
    vi.useRealTimers();
  });
});
