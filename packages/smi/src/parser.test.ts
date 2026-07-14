import { describe, expect, it } from 'vitest';
import { normalizeMibSource, parseModules, parseModulesIncremental } from './parser';

const VALID = `TEST-MIB DEFINITIONS ::= BEGIN
testRoot OBJECT IDENTIFIER ::= { iso 424242 }
END`;

describe('SMI parse pipeline', () => {
  it('normalizes BOMs, line endings, tabs, formfeeds, and control bytes with diagnostics', () => {
    const result = normalizeMibSource({
      name: 'dirty.mib',
      content: `\uFEFFTEST-MIB DEFINITIONS ::= BEGIN\r\n\ttestRoot OBJECT IDENTIFIER ::= { iso 424242 }\f\u0000END`,
    });

    expect(result.content).toBe(
      `TEST-MIB DEFINITIONS ::= BEGIN\n  testRoot OBJECT IDENTIFIER ::= { iso 424242 }\nEND`,
    );
    expect(result.diagnostics.map(({ recovery }) => recovery)).toEqual([
      'stripped UTF-8 BOM',
      'normalized line endings',
      'expanded tab characters',
      'replaced formfeed with newline',
      'removed control character U+0000',
    ]);
    expect(result.diagnostics.every(({ severity }) => severity === 'recovered')).toBe(true);
  });

  it('appends a truncated END and returns a recovered file instead of crashing', () => {
    const result = parseModules([{ name: 'truncated.mib', content: VALID.replace(/\nEND$/, '') }]);

    expect(result.loaded).toContain('TEST-MIB');
    expect(result.files[0]?.status).toBe('recovered-with-diagnostics');
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ module: 'TEST-MIB', recovery: 'appended terminating END' }),
      ]),
    );
  });

  it('keeps good files when another file fails and preserves exact missing-import symbols', () => {
    const result = parseModules([
      { name: 'good.mib', content: VALID },
      {
        name: 'missing.mib',
        content: `MISSING-MIB DEFINITIONS ::= BEGIN
IMPORTS Widget, Gadget FROM ABSENT-MIB;
missingRoot OBJECT IDENTIFIER ::= { Widget 1 }
END`,
      },
    ]);

    expect(result.loaded).toContain('TEST-MIB');
    expect(result.files.map(({ status }) => status)).toEqual(['ok', 'failed']);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'error',
          module: 'ABSENT-MIB',
          symbol: 'Widget, Gadget',
        }),
      ]),
    );
  });

  it('recovers underscore identifiers without rewriting quoted descriptions', () => {
    const result = parseModules([
      {
        name: 'underscore.mib',
        content: `VENDOR_MIB DEFINITIONS ::= BEGIN
vendor_root OBJECT IDENTIFIER ::= { iso 424244 }
quoted_value OBJECT-TYPE
  SYNTAX INTEGER
  ACCESS read-only
  STATUS mandatory
  DESCRIPTION "keep_this_text"
  ::= { vendor_root 1 }
END`,
      },
    ]);

    expect(result.loaded).toContain('VENDOR-MIB');
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ recovery: 'replaced underscore in identifier VENDOR_MIB' }),
        expect.objectContaining({ recovery: 'replaced underscore in identifier vendor_root' }),
      ]),
    );
    expect(result.diagnostics.some(({ recovery }) => recovery?.includes('keep_this_text'))).toBe(
      false,
    );
  });

  it('injects the well-known enterprises import when it is used but omitted', () => {
    const result = parseModules([
      {
        name: 'missing-enterprises.mib',
        content: `ENTERPRISE-MIB DEFINITIONS ::= BEGIN
vendorRoot OBJECT IDENTIFIER ::= { enterprises 424245 }
END`,
      },
    ]);

    expect(result.loaded).toContain('ENTERPRISE-MIB');
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbol: 'enterprises',
          recovery: 'injected enterprises import from SNMPv2-SMI',
        }),
      ]),
    );
  });

  it('repairs Counter64 imported from the wrong legacy module', () => {
    const result = parseModules([
      {
        name: 'wrong-provider.mib',
        content: `COUNTER-MIB DEFINITIONS ::= BEGIN
IMPORTS Counter64 FROM RFC1155-SMI;
counterRoot OBJECT IDENTIFIER ::= { iso 424246 }
counterValue OBJECT-TYPE
  SYNTAX Counter64
  MAX-ACCESS read-only
  STATUS current
  DESCRIPTION "counter"
  ::= { counterRoot 1 }
END`,
      },
    ]);

    expect(result.loaded).toContain('COUNTER-MIB');
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbol: 'Counter64',
          recovery: 'rewrote Counter64 import from RFC1155-SMI to SNMPv2-SMI',
        }),
      ]),
    );
  });

  it('escapes unquoted quotes and normalizes smart punctuation inside DESCRIPTION', () => {
    const result = parseModules([
      {
        name: 'description.mib',
        content: `DESCRIPTION-MIB DEFINITIONS ::= BEGIN
descriptionRoot OBJECT IDENTIFIER ::= { iso 424247 }
descriptionValue OBJECT-TYPE
  SYNTAX INTEGER
  ACCESS read-only
  STATUS mandatory
  DESCRIPTION "Interface “uplink” says "ready""
  ::= { descriptionRoot 1 }
END`,
      },
    ]);

    expect(result.loaded).toContain('DESCRIPTION-MIB');
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ recovery: 'sanitized DESCRIPTION string' }),
      ]),
    );
  });

  it('keeps valid objects when unresolved objects are dropped and reports the parser warning', () => {
    const result = parseModules([
      {
        name: 'partial.mib',
        content: `PARTIAL-MIB DEFINITIONS ::= BEGIN
goodRoot OBJECT IDENTIFIER ::= { iso 424248 }
orphanRoot OBJECT IDENTIFIER ::= { absentParent 1 }
END`,
      },
    ]);

    expect(result.loaded).toContain('PARTIAL-MIB');
    expect(result.files[0]?.status).toBe('recovered-with-diagnostics');
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'warning',
          message: expect.stringContaining('orphanRoot'),
          recovery: 'kept loadable objects and dropped unresolved object',
        }),
      ]),
    );
  });

  it('tolerates missing identity and mixed SMIv1/v2 access macros with diagnostics', () => {
    const result = parseModules([
      {
        name: 'mixed-macros.mib',
        content: `MIXED-MACROS-MIB DEFINITIONS ::= BEGIN
MixedRoot OBJECT IDENTIFIER ::= { iso 424250 }
legacyValue OBJECT-TYPE
  SYNTAX INTEGER
  ACCESS read-only
  STATUS mandatory
  DESCRIPTION "legacy"
  ::= { MixedRoot 1 }
modernValue OBJECT-TYPE
  SYNTAX INTEGER
  MAX-ACCESS read-only
  STATUS current
  DESCRIPTION "modern"
  ::= { MixedRoot 2 }
END`,
      },
    ]);

    expect(result.loaded).toContain('MIXED-MACROS-MIB');
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ recovery: 'accepted module without MODULE-IDENTITY' }),
        expect.objectContaining({ recovery: 'accepted mixed SMIv1 and SMIv2 access macros' }),
        expect.objectContaining({
          symbol: 'MixedRoot',
          recovery: 'accepted uppercase value identifier',
        }),
      ]),
    );
  });

  it('yields between files and reports incremental progress', async () => {
    let eventLoopYielded = false;
    const progress: { completed: number; eventLoopYielded: boolean }[] = [];
    setTimeout(() => {
      eventLoopYielded = true;
    }, 0);

    const result = await parseModulesIncremental(
      [
        { name: 'one.mib', content: VALID.replaceAll('TEST-MIB', 'ONE-MIB') },
        {
          name: 'two.mib',
          content: VALID.replaceAll('TEST-MIB', 'TWO-MIB').replace('424242', '424251'),
        },
      ],
      {
        yieldEvery: 1,
        onProgress: ({ completed }) => progress.push({ completed, eventLoopYielded }),
      },
    );

    expect(result.loaded).toEqual(expect.arrayContaining(['ONE-MIB', 'TWO-MIB']));
    expect(progress).toEqual([
      { completed: 1, eventLoopYielded: false },
      { completed: 2, eventLoopYielded: true },
    ]);
  });
});
