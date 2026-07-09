# 06 — Online MIB Auto-Resolution

Status: not-started
Depends on: 03 (consumes its `MIB_MISSING_IMPORTS` contract)

## Objective

The headline differentiator: when a MIB import fails on missing IMPORTS, or the user hits an unknown OID (walk result, received trap), the app offers to resolve it from the internet — recursively fetching the whole dependency closure from trustworthy sources, validating, caching, and attributing every file. Opt-in, offline-friendly, polite.

All URL patterns below were live-verified 2026-07-08 (see research notes in git history). Re-verify quickly during implementation; sources do rot.

## Design

### Source abstraction (`packages/resolver/src/sources/`)

```ts
interface MibSource {
  id: string; kind: SourceKind; name: string; enabled: boolean; priority: number;
  // resolve a module name to file content, or null if this source doesn't have it
  fetchModule(name: string, ctx: FetchContext): Promise<FetchedMib | null>;
  test(ctx: FetchContext): Promise<SourceTestResult>;   // resolve SNMPv2-MIB end-to-end
}
// FetchedMib { moduleName, content, sourceId, url, fetchedAt }
```

- **`@mib@` URL-template convention** (pysmi-compatible, the de-facto standard): a source is often just a template string; `@mib@` is replaced with each candidate filename; if absent, the name is appended.
- **Name-variant probing** (port of pysmi's `get_mib_variants`): candidates = {as-given, UPPER, lower} × extensions {"", ".txt", ".mib", ".my", ".TXT", ".MIB", ".MY"} — bounded, ordered, stop at first validated hit. Sources can declare a fixed extension to skip probing (e.g. cisco repo is always `.my`).
- **Content validation (mandatory, every source incl. custom)**: `validateMibContent(name, body)` — size ≤ cap (default 5MB); must match `/^\s*([A-Za-z][A-Za-z0-9-]*)\s+(?:PIB-)?DEFINITIONS\b[\s\S]*::=\s*BEGIN/` within the first 2KB (allowing leading comments `--`); reject anything containing `<html`/`<!DOCTYPE` early. Module name in file SHOULD match requested (case-insensitive); mismatch = accept-with-warning (some files define aliases) but record it. This gate exists because real sources soft-200 with HTML.

### Built-in source chain (default priority order)

| # | Source | Pattern | Notes |
|---|---|---|---|
| 0 | Local cache | `mib_cache` table + content-addressed files | always first; also "bundled" base MIBs from node-net-snmp count as present |
| 1 | pysnmp corpus | `https://mibs.pysnmp.com/asn1/@mib@` | LeXtudio-maintained, ~10k modules (IETF/IANA + huge multi-vendor snmplabs archive), clean 404 on miss, exists to be machine-fetched (pysmi's default) |
| 2 | pysnmp corpus mirror | `https://raw.githubusercontent.com/lextudio/mibs.pysnmp.com/master/asn1/@mib@` | same corpus, different infra; failover for #1 (skip if #1 responded but 404'd — same content) |
| 3 | LibreNMS collection | GitHub tree-index source (see below) over `librenms/librenms` branch `master`, prefix `mibs/` | filename == module name, vendor subdirs; best for post-2020 vendor MIBs |
| 4 | Cisco official | `https://raw.githubusercontent.com/cisco/cisco-mibs/main/v2/@mib@.my` (mirror `https://cisco.github.io/cisco-mibs/v2/@mib@.my`) | try only when name matches `/^CISCO/`; official replacement for dead ftp.cisco.com |
| 5 | netdisco-mibs | GitHub tree-index source over `netdisco/netdisco-mibs` `master` | curated/patched vendor MIBs; files `.txt`/`.my` |
| 6 | mibbrowser.online | `https://mibbrowser.online/mibs/@mib@.mib` | unofficial fallback; clean 404s |
| 7 | Circitor | `https://circitor.fr/Mibs/Mib/<FirstLetter>/@mib@.mib` | **ship disabled by default**: Cloudflare bot protection + soft-200 HTML on miss (2026). Content validator makes it safe to enable manually |

Do NOT include (verified dead 2026): `kcompher/MIBS`, `hariomrana/MIB`, `ftp.cisco.com`.

**GitHub tree-index source type** (shared with plan 07 custom sources): on first use, `GET https://api.github.com/repos/<owner>/<repo>/git/trees/<branch>?recursive=1`, filter paths by prefix, build `moduleName → path` map (module name = basename minus extension), persist the index (`sources` config or its own cache table) with fetched-at; refresh manually or when a lookup misses and index is >30 days old. Unauthenticated Trees API = 60 req/h — the aggressive index caching is what makes this viable; raw.githubusercontent.com fetches themselves are effectively unlimited.

### Resolution pipeline (`packages/resolver/src/resolve.ts`)

```
resolveModules(names):
  queue = names; resolved = {}; failed = {}; seen = {}
  while queue not empty (breadth-first, cycle-guarded by seen, depth cap 25, total-module cap 200):
    mod = dequeue
    for source of enabled sources by priority:
      hit = source.fetchModule(mod)          # includes variant probing + validation
      if hit: break
    if !hit: failed[mod]; continue
    cache(hit)                                # mib_cache row + file; keep source attribution
    parse-check via @omc/smi (parse only, don't load into user catalog yet)
    enqueue its own missing IMPORTS not already loaded/seen
  return { resolved, failed, graph }          # graph: who-needed-what, for the UI
```

- Streams progress events per module/source attempt (drives UI log: "IF-MIB ✓ mibs.pysnmp.com · CISCO-SMI ✓ cisco-mibs · FOO-MIB ✗ not found in 6 sources").
- After resolution completes, load the closure into the catalog in dependency order (leaves first), then retry the originally-failed import; final report reuses plan 03's import summary UI.
- Per-fetch: timeout 15s, one retry, exponential backoff on 429/403 (and per-source cool-down so a rate-limited source doesn't stall the chain), honest `User-Agent: OpenMIBCatalog/<version> (+https://github.com/<org>/openmibcatalog)`.
- Concurrency: ≤3 parallel module fetches, ≤2 per host.

### Unknown-OID lookup (`resolver.lookupOid`)
For a numeric OID with no loaded MIB match (from results table, trap console, or the search field):
1. Local: longest-prefix over loaded modules + cached-but-unloaded modules (offer "load cached module X").
2. **IANA enterprise arc**: if OID under `1.3.6.1.4.1.<N>`, resolve `<N>` against IANA `enterprise-numbers.txt` (`https://www.iana.org/assignments/enterprise-numbers.txt`, fetch once + cache with periodic refresh; parse to `{n, org, contact}`) → tells the user the vendor immediately, and enables a targeted follow-up: search the LibreNMS/netdisco tree indexes for that vendor's directory and offer candidate MIB modules to fetch — turning OID lookup back into MIB resolution.
3. `https://oid-base.com/get-md/<dotted-oid>` — returns Markdown with YAML frontmatter (`oid`, `asn1-notation`, `description`, `last-modified`): parse frontmatter, show as an "online lookup" card with source attribution. Rate-limit (≥1s between calls) + cache lookups (`settings`-adjacent table or mib_cache-like table); operators discourage bulk scraping — lookups are user-initiated only, never automatic batch.
4. Fallback: `https://oidref.com/<dotted-oid>` HTML scrape (title + description meta) — best-effort.
5. Link-out button: `https://mibs.observium.org/search?q=<oid>` (human reference; no raw endpoint — do not scrape).

### Settings & privacy
- Master switch `resolver.enabled` default **off**. First time a missing-import or unknown-OID affordance is tapped, show a one-time explainer ("this contacts these servers with the module names you're resolving — nothing else") with enable/cancel. Per-source enable toggles + reorder live in plan 07's sources manager.
- Everything fetched is cached (content-addressed file + `mib_cache` row with source, url, etag, fetched-at); resolution retries hit cache first → repeat resolutions work fully offline.
- "Clear online cache" + cache size display in settings.

## Tasks
1. `@omc/resolver` package: source abstraction, template source, GitHub tree-index source, variant probing, content validator, cache manager, pipeline with events, IANA parser, oid-base/oidref lookup clients. All HTTP via `@omc/transport` HttpClient.
2. Built-in source registry with the table above as seed data (rows in `sources` table on first run; user-editable priority/enabled from plan 07 UI, but seed + hardcoded fallback-to-defaults belongs here).
3. Engine surface: `resolver.getSettings/setSettings/resolveModules/lookupOid` + events.
4. UI integration: (a) import-summary "N imports missing → Resolve online" button → progress sheet with per-module/per-source live log → success reloads module; (b) results-table & trap-console "unknown OID" affordance → lookup card (local/IANA/oid-base sections + "fetch candidate MIB" actions); (c) first-run opt-in explainer; (d) settings section (master switch, cache mgmt).
5. Fixture infrastructure for tests: local HTTP server serving a fake source tree (good MIBs, HTML soft-200s, 404s, 429s, oversized files, wrong-module-name files).

## Acceptance criteria
1. Import a vendor MIB whose IMPORTS chain needs ≥3 modules (e.g. a CISCO-* MIB depending on CISCO-SMI, CISCO-TC, SNMPv2-TC…) with an empty catalog + enabled resolver → whole closure fetched, validated, cached, loaded, original module parses; progress log shows per-source attribution. Works on desktop AND Android.
2. Kill network → same resolution replays entirely from cache.
3. A module that exists nowhere → clean per-source "not found" report, no HTML garbage in cache (soft-200 fixture proves the validator).
4. Unknown-OID flow: `1.3.6.1.4.1.9.9.x.y.z` with empty catalog → card shows "Cisco Systems (IANA #9)" + oid-base description + candidate cisco MIBs offered from tree index.
5. Resolver fully off by default; zero network calls before opt-in (verify with a proxy/netlog during a fresh-install session).
6. GitHub tree index built once and reused (proven by request counting against a mock); backoff on 429 fixture works.

## Test strategy
- Unit: validator (good/HTML/oversized/mismatched-name/PIB), variant generator vs pysmi's documented behavior, pipeline on a mocked source graph (diamond deps, cycles, depth cap, partial failure), IANA file parser, oid-base frontmatter parser.
- Integration: full pipeline against the local fixture server; cache-replay offline test.
- Manual (recorded in this doc's Deviations/notes): one real resolution per built-in source at implementation time to confirm patterns still live; adjust and note any rot.

## Out of scope
Custom user sources UI (plan 07 — but the source abstraction here is what they implement), auto-resolution without prompt (never — by design), bundling vendor MIB packs in releases (licensing care needed; post-v1 discussion).
