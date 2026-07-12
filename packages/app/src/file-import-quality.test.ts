import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import {
  acquireWithVisibleFailure,
  buildFileImportReview,
  createInitialFileSelection,
  prepareFileImport,
  scanMibMetadata,
  structuralMibDiagnostics,
  semanticMibDiagnostics,
  unzipForRuntime,
  validateFileImportSelection,
} from './file-import';

const mib = (name: string, body = '') => `${name} DEFINITIONS ::= BEGIN\n${body}\nEND`;
const TOY_MIB = `TOY-MIB DEFINITIONS ::= BEGIN
IMPORTS MODULE-IDENTITY, OBJECT-TYPE, Integer32, enterprises FROM SNMPv2-SMI;
toyMIB MODULE-IDENTITY
 LAST-UPDATED "202601010000Z" ORGANIZATION "test" CONTACT-INFO "test" DESCRIPTION "toy"
 ::= { enterprises 99999 }
toyValue OBJECT-TYPE
 SYNTAX Integer32 MAX-ACCESS read-only STATUS current DESCRIPTION "toy value"
 ::= { toyMIB 1 }
END`;

describe('file import quality boundaries', () => {
  it('keeps same-path sources independently selectable using stable candidate IDs', async () => {
    const prepared = await prepareFileImport([
      { id: 'picker-a', name: 'same.mib', relativePath: 'same.mib', bytes: strToU8(mib('A-MIB')) },
      { id: 'picker-b', name: 'same.mib', relativePath: 'same.mib', bytes: strToU8(mib('B-MIB')) },
    ]);
    const review = buildFileImportReview(prepared, [], [], new Map());
    expect(review.files.map((file) => file.id)).toEqual(['picker-a', 'picker-b']);
    expect(new Set(review.files.map((file) => file.id)).size).toBe(2);
    const selected = createInitialFileSelection(review);
    expect(selected).toEqual(new Set(['picker-a', 'picker-b']));
    expect(validateFileImportSelection(review, selected, new Set()).files.map((file) => file.name)).toEqual(['same.mib', 'same.mib']);
  });

  it('ignores multiline/doubled-quote and comment lookalikes while scanning real declarations', () => {
    const text = `REAL-MIB DEFINITIONS ::= BEGIN\n-- FAKE-COMMENT DEFINITIONS ::= BEGIN\nthing MODULE-IDENTITY\n DESCRIPTION "first line\nFAKE-STRING DEFINITIONS ::= BEGIN\nIMPORTS bogus FROM BAD-MIB; and ""quoted"" text"\n ::= { iso 3 }\nIMPORTS realSymbol FROM REAL-DEP;\nEND`;
    expect(scanMibMetadata(text)).toEqual({
      modules: ['REAL-MIB'],
      imports: [{ module: 'REAL-DEP', symbols: ['realSymbol'] }],
    });
  });

  it('reports local structural errors without semantic engine parsing', () => {
    expect(structuralMibDiagnostics('BAD-MIB DEFINITIONS ::= BEGIN\nIMPORTS x FROM X-MIB\nbad OBJECT IDENTIFIER { iso 3 }')).toEqual(expect.arrayContaining([
      expect.stringContaining('IMPORTS'),
      expect.stringContaining('END'),
    ]));
  });

  it('does not treat imported macros as declarations and accepts the existing TOY_MIB', async () => {
    expect(structuralMibDiagnostics(TOY_MIB)).toEqual([]);
    const prepared = await prepareFileImport([{ name: 'toy.mib', bytes: strToU8(TOY_MIB) }]);
    await expect(semanticMibDiagnostics(prepared.candidates)).resolves.toEqual(new Map());
  });

  it('rejects the exact header-junk-END fixture with an explicit declaration guard', async () => {
    const prepared = await prepareFileImport([{ name: 'broken.mib', bytes: strToU8('TOY-MIB DEFINITIONS ::= BEGIN broken END') }]);
    const errors = await semanticMibDiagnostics(prepared.candidates);
    expect(errors.get(prepared.candidates[0]!.id)).toContain('Semantic SMI parse failed: MIB module contains no real declaration assignment');
  });

  it('blocks a structurally balanced declaration rejected by the semantic parser', async () => {
    const prepared = await prepareFileImport([{ name: 'broken.mib', bytes: strToU8(mib('BROKEN-MIB', 'broken OBJECT IDENTIFIER ::= { iso }')) }]);
    expect(structuralMibDiagnostics(prepared.candidates[0]!.text)).toEqual([]);
    const diagnostics = await semanticMibDiagnostics(prepared.candidates);
    expect(diagnostics.get(prepared.candidates[0]!.id)?.[0]).toContain('Semantic SMI parse failed');
  });

  it('semantically validates normal missing imports with local stubs', async () => {
    const prepared = await prepareFileImport([{ name: 'child.mib', bytes: strToU8(mib('CHILD-MIB', 'IMPORTS parent FROM DEP-MIB;\nchild OBJECT IDENTIFIER ::= { parent 1 }')) }]);
    await expect(semanticMibDiagnostics(prepared.candidates)).resolves.toEqual(new Map());
  });

  it('classifies a DOCS-like imported syntax symbol as a textual-convention stub', async () => {
    const docs = mib('DOCS-LIKE-MIB', `IMPORTS VendorCertificate FROM VENDOR-TC-MIB, enterprises FROM SNMPv2-SMI;
docsRoot OBJECT IDENTIFIER ::= { enterprises 55555 }
docsCertificate OBJECT-TYPE
 SYNTAX VendorCertificate
 MAX-ACCESS read-only
 STATUS current
 DESCRIPTION "certificate"
 ::= { docsRoot 1 }`);
    const prepared = await prepareFileImport([{ name: 'docs.mib', bytes: strToU8(docs) }]);
    await expect(semanticMibDiagnostics(prepared.candidates)).resolves.toEqual(new Map());
  });

  it('validates reverse-order cyclic batches in an isolated client parser', async () => {
    const prepared = await prepareFileImport([
      { name: 'b.mib', bytes: strToU8(mib('B-MIB', 'IMPORTS a FROM A-MIB;\nb OBJECT IDENTIFIER ::= { a 1 }')) },
      { name: 'a.mib', bytes: strToU8(mib('A-MIB', 'IMPORTS b FROM B-MIB;\na OBJECT IDENTIFIER ::= { b 1 }')) },
    ]);
    await expect(semanticMibDiagnostics(prepared.candidates)).resolves.toEqual(new Map());
    const bundled = await prepareFileImport([{
      name: 'cycle-bundle.mib',
      bytes: strToU8(`${mib('B-MIB', 'IMPORTS a FROM A-MIB;\nb OBJECT IDENTIFIER ::= { a 1 }')}\n${mib('A-MIB', 'IMPORTS b FROM B-MIB;\na OBJECT IDENTIFIER ::= { b 1 }')}`),
    }]);
    await expect(semanticMibDiagnostics(bundled.candidates)).resolves.toEqual(new Map());
  });

  it('turns picker exceptions into visible review rejections', async () => {
    const result = await acquireWithVisibleFailure(async () => { throw new Error('permission denied'); }, 'File picker');
    expect(result.status).toBe('selected');
    expect(result.rejections).toContainEqual(expect.objectContaining({ path: 'File picker', message: expect.stringContaining('permission denied') }));
  });

  it('extracts a large ZIP asynchronously and yields before completion', async () => {
    const archive = zipSync(Object.fromEntries(Array.from({ length: 80 }, (_, index) => [`mibs/${index}.mib`, strToU8(mib(`M${index}-MIB`))])));
    let timerRan = false;
    const timer = new Promise<void>((resolve) => setTimeout(() => { timerRan = true; resolve(); }, 0));
    const pending = prepareFileImport([{ id: 'zip-1', name: 'many.zip', bytes: archive }]);
    await timer;
    expect(timerRan).toBe(true);
    const prepared = await pending;
    expect(prepared.candidates).toHaveLength(80);
    expect(new Set(prepared.candidates.map((candidate) => candidate.id)).size).toBe(80);
    expect(prepared.candidates.every((candidate) => candidate.archiveId === 'zip-1')).toBe(true);
  });

  it('uses the React Native streaming decoder without Worker for a large entry', async () => {
    const content = strToU8('LARGE-MIB DEFINITIONS ::= BEGIN\n' + 'a'.repeat(600 * 1024) + '\nEND');
    const archive = zipSync({ 'folder/large.mib': content }, { level: 9 });
    const globals = globalThis as typeof globalThis & { Worker?: unknown };
    const previous = globals.Worker;
    globals.Worker = undefined;
    try {
      let yielded = false;
      const timer = new Promise<void>((resolve) => setTimeout(() => { yielded = true; resolve(); }, 0));
      const pending = unzipForRuntime(archive, 'react-native');
      await timer;
      expect(yielded).toBe(true);
      const entries = await pending;
      expect(entries['folder/large.mib']).toEqual(content);
    } finally {
      globals.Worker = previous;
    }
  });
});
