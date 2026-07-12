# 03 — MIB Catalog & Parser

Status: in-progress (core slice landed early with the UI overhaul)

> **Landed early** (`@omc/smi` + engine `mibs` domain + Browse/MIBs UI): text-based
> MIB parsing on every platform (`MibStore.importTexts`, no fs — base modules bundled
> in `packages/smi/src/base-mibs.generated.ts` and loaded via `ParseModule` so React
> Native works), an OID tree index (`OidIndex`: children/node/resolve/search with node
> kinds and syntax formatting), URL + paste import with a soft-200/`DEFINITIONS ::= BEGIN`
> content validator, persistence in the `mib_modules` table, and MIB-resolved names on
> all query results + traps. Verified on web (playwright) and Android (emulator).
> **Still remaining here:** lenient-recovery catalogue + structured diagnostics UI, the
> pathological-MIB corpus harness, and the DISPLAY-HINT / table-info
> (INDEX/AUGMENTS) audit for Table View.
>
> **Interactive module focus landed:** loaded-module rows now open a sparse, lazy OID
> projection containing that module's definitions, imported symbols, and connector
> ancestors. Rows are tagged `this MIB`, `dependency`, or `parent`.
>
> **File import landed:** web/Electron support multi-file selection, folder selection,
> and recursive drag/drop; Android supports documents plus Storage Access Framework
> folders; iOS uses multi-file/ZIP fallback. ZIP expansion and local structural review
> happen before confirmation, selected LAN-browser content is not uploaded before the
> review action, and batch parsing/replacement is transactional across the catalog,
> resolver cache, and SQLite persistence.

Depends on: 02

## Objective

Users can import any real-world MIB file (however broken), see exactly what parsed and what didn't, browse the resulting tree with full node metadata, and manage the set of loaded modules — with no artificial caps. This phase also produces the OID index every other feature depends on.

## Background & decisions

- Base parser: node-net-snmp's `ModuleStore` (`store.loadFromFile()`, `getModule()`, base MIBs preloaded). It is less battle-hardened than libsmi/pysmi — so this phase's core deliverable is a **wrapper pipeline with a corpus-driven test harness** that measures and improves real-world parse coverage, not blind trust.
- Lenient parsing is *the* reason engineers pick iReasoning. We match it and beat it on transparency: every recovery is a visible, structured diagnostic.

## Tasks

### T1 — Corpus harness (build FIRST — it drives everything else)
- `dev/corpus/fetch-corpus.ts`: script that shallow-clones/downloads a pinned revision of `netdisco/netdisco-mibs` (curated, patched vendor MIBs — good "should parse" ground truth) and a selected subset of `librenms/librenms` `mibs/` (raw vendor reality). Store under `dev/corpus/` (gitignored), pin revisions in a checked-in lockfile.
- `dev/corpus/run-corpus.ts`: parse every file through `@omc/smi`, emit `corpus-report.json`: per-file status (ok / recovered-with-diagnostics / failed), error class, timing. Summary: pass rate, top-10 failure causes, slowest files.
- Wire a `pnpm corpus` script. Not part of default CI (size/time); run at the end of this phase and record results in this doc under `## Corpus results`.

### T2 — @omc/smi parse pipeline
`packages/smi/src/`:
- `parser.ts` — `parseModules(input: SourceFile[]): ParsedBatch`. Steps per file:
  1. **Pre-lex normalization** (each fix recorded as a `ParseDiagnostic` with `severity: 'recovered'`): strip BOM/control chars, normalize line endings, tolerate tabs, handle files containing multiple MODULE definitions, strip stray page-break/formfeed artifacts common in RFC extracts.
  2. ModuleStore parse in try/catch; on failure, classify the error, attempt targeted recoveries (see T3), retry bounded number of times.
  3. Extract module metadata: name, LAST-UPDATED/REVISION, ORGANIZATION, IMPORTS list, object count.
- `diagnostics.ts` — `ParseDiagnostic { severity: 'info'|'recovered'|'warning'|'error'; module?; line?; symbol?; message; recovery? }`. `MIB_MISSING_IMPORTS` failures carry the exact missing `{ module, symbols[] }[]` — this is the resolver's (plan 06) input contract, so get it precise.
- `oid-index.ts` — after successful loads, build/update: trie for longest-prefix OID→node resolution, name→OID map, and a search index (see T5).
- Incremental/yielding wrapper so multi-MB parses don't block the RN JS thread (chunk per module or per N definitions; measure with the corpus timing data; escalate to a worker only if >200ms chunks are unavoidable — record the decision here).

### T3 — Lenient-recovery catalogue
Implement recoveries as small, individually-tested transforms, driven by what the corpus report shows. Known common breakages to handle (extend from corpus data):
- Missing/misspelled imports of well-known symbols (`Counter64` from wrong module, `enterprises` unimported) → inject synthetic import, diagnostic.
- Underscores in identifiers, identifiers starting uppercase where lowercase required → tolerate, diagnostic.
- Malformed DESCRIPTION strings (unescaped quotes, non-ASCII) → sanitize, diagnostic.
- MODULE-IDENTITY missing/duplicated, SMIv1/v2 macro mixing → tolerate.
- Truncated final `END` → append, diagnostic (warning).
- Duplicate OID assignments across modules → last-load wins for tree display, but BOTH retained in the index with a `warning` diagnostic (this matters for vendor MIBs that hijack standard arcs).
When a recovery would change semantics ambiguously, prefer failing that *object* with an `error` diagnostic while keeping the rest of the module — partial load beats total rejection.

### T4 — Table/index semantics audit (feeds plan 04's Table View)
- Verify, against corpus + unit fixtures, that the pipeline surfaces per-table: INDEX column list (incl. IMPLIED), AUGMENTS resolution to the base table, index object syntaxes needed for instance decoding, and DISPLAY-HINT / TEXTUAL-CONVENTION resolution chains.
- Wherever `ModuleStore` doesn't expose a needed piece, extract it from its parsed JSON representation in `@omc/smi` helpers (`table-info.ts`, `display-hint.ts` — implement DISPLAY-HINT formatting for OCTET STRING and INTEGER hints per RFC 2579 §3.1, with unit tests: `1x:`, `255a`, `d-2`, MAC/IP/date-and-time cases).

### T5 — Engine + catalog surface
`packages/core`:
- Implement `EngineAPI.mibs.*` fully (importFiles from paths [desktop] or `{name, content}` [mobile document picker], unload, listModules, lazy getTree, getNode, translate, search).
- Persistence: `mib_modules` table (per plan 01 schema); re-load enabled modules at engine start from stored source paths/content; store content-addressed copies under app data `mibs/` so a moved/deleted original doesn't break the catalog.
- Search: fuzzy over node name + module + numeric OID prefix + DESCRIPTION full text. Ranking: exact name > name prefix > fuzzy name > OID prefix > description hit. Return ≤ limit with match-highlight spans.

### T6 — UI screens (`packages/app` / `packages/ui`)
- **MIB tree pane**: virtualized tree (`MibTree`), lazy expansion via `mibs.getTree`, node-type icons (module root, subtree, table, entry, column, scalar, notification, index — distinct glyphs read-write vs read-only), multi-select context menu (Walk/Get/Table View wired in plan 04; Unload on module roots now).
- **Node properties panel**: OID (tap-to-copy, both numeric and name form), module, syntax + resolved TC chain, access, status, units, DESCRIPTION (scrollable), INDEX/AUGMENTS info for tables.
- **Catalog manager screen**: loaded modules list (name, revision, organization, object count, parse status chip), import button (file/folder picker on desktop; document picker + paste-text on mobile), unload, per-module diagnostics viewer (grouped by severity, line numbers, recovery notes), "copy diagnostics" for bug reports.
- **Global search UI**: search field above tree (Ctrl-F focus), results list jumps tree to node.
- Import UX: drag-and-drop files onto the tree pane (desktop), progress for folder imports, end-of-import summary sheet ("14 modules loaded, 2 recovered with warnings, 1 failed — 3 imports missing" — the missing-imports affordance becomes the resolver entry point in plan 06; for now it shows the list with "resolve online (coming soon)" disabled state or hidden).

## Acceptance criteria
1. Corpus: **≥95% of netdisco-mibs parses ok-or-recovered** (it's a curated corpus; failures below that bar need triage notes). librenms subset pass rate recorded (no hard bar, it's raw reality). `## Corpus results` section filled in below.
2. Importing a deliberately broken MIB (fixture set) yields partial load + precise diagnostics, never a crash or silent drop.
3. Tree renders and stays responsive with the full netdisco `rfc/` + `cisco/` sets loaded (thousands of nodes, virtualized) on desktop AND Android.
4. `translate('1.3.6.1.2.1.2.2.1.8')` → `ifOperStatus` and reverse; longest-prefix resolution works for instance OIDs (`...2.2.1.8.3` → `ifOperStatus.3`).
5. Search finds `ifHCInOctets` from partial/fuzzy input in <100ms with the full corpus loaded (desktop measurement).
6. Modules and load-state survive app restart on both platforms.

## Test strategy
- Unit: every recovery transform (fixture in → parsed out + expected diagnostics); DISPLAY-HINT formatter table-driven tests; OID trie (prefix, exact, miss); search ranking.
- Integration: import→persist→restart→still-loaded (temp DB); duplicate-OID handling.
- Corpus run: manual, results recorded here.
- Adversarial: fuzz-ish fixtures (deep nesting, 10MB single line, binary garbage with `.mib` extension) must fail gracefully with `MIB_PARSE_FAILED`, bounded memory/time.

## Corpus results
_(fill in at end of phase: date, corpus revisions, pass rates, top failure causes, perf numbers, decisions taken)_

## Out of scope
Online resolution of the missing imports (plan 06 — but the `MIB_MISSING_IMPORTS` data contract is delivered here), MIB module diff/compare (plan 08), editing MIBs (not in v1).
