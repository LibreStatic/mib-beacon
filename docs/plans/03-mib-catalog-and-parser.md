# 03 — MIB Catalog & Parser

Status: implemented (automated acceptance complete; full-corpus platform responsiveness and physical-device restart evidence remain release checks)

> **Landed early** (`@mibbeacon/smi` + engine `mibs` domain + Browse/MIBs UI): text-based
> MIB parsing on every platform (`MibStore.importTexts`, no fs — base modules bundled
> in `packages/smi/src/base-mibs.generated.ts` and loaded via `ParseModule` so React
> Native works), an OID tree index (`OidIndex`: children/node/resolve/search with node
> kinds and syntax formatting), URL + paste import with a soft-200/`DEFINITIONS ::= BEGIN`
> content validator, persistence in the `mib_modules` table, and MIB-resolved names on
> all query results + traps. Verified on web (playwright) and Android (emulator).
> **Still remaining here:** lenient-recovery catalogue + structured diagnostics UI, the
> the corpus-backed table-info audit and responsiveness evidence for incremental parsing. The
> corpus harness, DISPLAY-HINT formatter, INDEX/IMPLIED/AUGMENTS fixture coverage, and the first structured parse-pipeline
> slice (normalization, exact missing-import diagnostics, per-file partial success, and truncated
> `END` recovery) landed on 2026-07-13.
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
- Lenient parsing is _the_ reason engineers pick iReasoning. We match it and beat it on transparency: every recovery is a visible, structured diagnostic.

## Tasks

### T1 — Corpus harness (build FIRST — it drives everything else)

- `dev/corpus/fetch-corpus.ts`: script that shallow-clones/downloads a pinned revision of `netdisco/netdisco-mibs` (curated, patched vendor MIBs — good "should parse" ground truth) and a selected subset of `librenms/librenms` `mibs/` (raw vendor reality). Store under `dev/corpus/` (gitignored), pin revisions in a checked-in lockfile.
- `dev/corpus/run-corpus.ts`: parse every file through `@mibbeacon/smi`, emit `corpus-report.json`: per-file status (ok / recovered-with-diagnostics / failed), error class, timing. Summary: pass rate, top-10 failure causes, slowest files.
- Wire a `pnpm corpus` script. Not part of default CI (size/time); run at the end of this phase and record results in this doc under `## Corpus results`.

### T2 — @mibbeacon/smi parse pipeline

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
  When a recovery would change semantics ambiguously, prefer failing that _object_ with an `error` diagnostic while keeping the rest of the module — partial load beats total rejection.

### T4 — Table/index semantics audit (feeds plan 04's Table View)

- Verify, against corpus + unit fixtures, that the pipeline surfaces per-table: INDEX column list (incl. IMPLIED), AUGMENTS resolution to the base table, index object syntaxes needed for instance decoding, and DISPLAY-HINT / TEXTUAL-CONVENTION resolution chains.
- Wherever `ModuleStore` doesn't expose a needed piece, extract it from its parsed JSON representation in `@mibbeacon/smi` helpers (`table-info.ts`, `display-hint.ts` — implement DISPLAY-HINT formatting for OCTET STRING and INTEGER hints per RFC 2579 §3.1, with unit tests: `1x:`, `255a`, `d-2`, MAC/IP/date-and-time cases).

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

Run on 2026-07-13 with the checked-in `dev/corpus/corpus-lock.json` revisions:

- `netdisco/netdisco-mibs` at `e981548ffb72c92517631b37e4fc17b64d8da3a1`: 4,631
  candidate files, 4,544 parsed cleanly, 28 parsed with node-mount warnings, and 59 failed;
  **98.73% ok-or-recovered** (above the 95% acceptance threshold).
- LibreNMS vendor subset (`arista`, `cisco`, `juniper`, and `mikrotik`) at
  `d38b35f2c09447e6b90067052772901fe0eed215`: 796 candidate files, 778 parsed
  cleanly, 3 parsed with diagnostics, and 15 failed; **98.12% ok-or-recovered**.
- Combined: 5,427 files, 5,322 clean, 31 recovered-with-diagnostics, 74 failed;
  **98.64% ok-or-recovered**. The eight-worker run completed in about 2 minutes 48 seconds.
- Failure triage: 38 node-net-snmp parser exceptions caused by missing internal values, 18 files
  with no loadable module definition, 16 files exceeding the bounded 5-second per-file timeout,
  one truncated file without `END`, and one file without valid declarations. The slowest list and
  per-file diagnostics are retained in the generated, gitignored
  `dev/corpus/corpus-report.json`.

The harness parses each file in an isolated worker through `@mibbeacon/smi`'s parse-check pipeline,
which supplies temporary dependency stubs for missing imports. This prevents duplicate vendor module
names from contaminating one another, limits pathological files without blocking the run, and keeps
the result focused on whether each document is loadable. Parser `console.warn` node-mount messages
are captured as `recovered-with-diagnostics` rather than being silently discarded. Use
`CORPUS_WORKERS`, `CORPUS_FILE_TIMEOUT_MS`, and `CORPUS_LIMIT` to tune local investigation runs.

## Out of scope

Online resolution of the missing imports (plan 06 — but the `MIB_MISSING_IMPORTS` data contract is delivered here), MIB module diff/compare (plan 08), editing MIBs (not in v1).

## Deviations and remaining release evidence

- The parser stays on the yielding, isolated-worker design rather than adding a second parser stack;
  the recorded corpus run remained bounded and exceeded the acceptance-rate target.
- Diagnostics, access state, table/index metadata, multi-select actions, and import summaries are
  exposed through the shared catalog/Browse UI rather than a desktop-only diagnostics window.
- Automated fixtures cover partial recovery, translation, search ranking, persistence, composite
  indexes, and a 10,000-row virtualized surface. A packaged full-corpus responsiveness/restart run
  on desktop and a physical Android device remains release evidence and is not claimed here.
