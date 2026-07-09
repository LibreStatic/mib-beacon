# 07 — Custom Resolver Sources

Status: not-started
Depends on: 06

## Objective

Let users plug their own MIB repositories into the resolver chain: bare-bones FTP servers (with or without auth), plain HTTP endpoints exposing raw MIBs, JSON HTTP catalogs queried with a user-supplied JSONPath expression, and arbitrary GitHub repos. Enterprises hoard MIBs on dusty internal servers — this feature meets them there.

All custom sources implement the `MibSource` interface from plan 06 and pass through the same content-validation gate, variant probing (where applicable), caching, and attribution. They participate in the same priority-ordered chain as built-ins.

## Source types

### 1. HTTP raw source
- Config: `{ urlTemplate, authKind: none|basic, username?, passwordRef?, headers?, fixedExtension? }`.
- `urlTemplate` uses `@mib@` (pysmi convention — any pysmi source string a user already has just works; if `@mib@` absent, append the name). Variant probing on unless `fixedExtension` set.
- Basic auth via header; password in SecretStore. Custom headers allow token-style auth (e.g. private artifact servers) without dedicated OAuth machinery.

### 2. FTP source
- Config: `{ host, port=21, secure: none|ftps-explicit, anonymous: bool, username?, passwordRef?, pathTemplate }` — `pathTemplate` uses `@mib@` (e.g. `/pub/mibs/@mib@` or `/mibs/@mib@.txt`); variant probing applies.
- Client: `basic-ftp` (pure JS over `net`/`tls`) on desktop. On mobile, `net`→`react-native-tcp-socket` alias (it also provides TLS) — validate during implementation with a real FTP server; if `basic-ftp`'s socket usage doesn't survive the shim, implement a minimal FTP-retrieve client (`USER/PASS/TYPE I/PASV/RETR` is a few hundred lines) in `@omc/resolver` — decision + outcome recorded here.
- Passive mode only (NAT-friendly). Timeout + one retry like HTTP. Directory listing NOT required (RETR by constructed path); a "browse server" nicety is post-v1.

### 3. JSON catalog source
For HTTP services exposing a catalog document instead of predictable paths.
- Config: `{ catalogUrl, urlQuery, nameQuery?, authKind/credentials as HTTP, refreshDays=30 }`.
- Behavior: fetch `catalogUrl` (JSON; size cap 20MB) → evaluate **`urlQuery`** — a JSONPath expression ([`jsonpath-plus`](https://github.com/JSONPath-Plus/JSONPath)) — against it, yielding the list of MIB file URLs; optionally evaluate `nameQuery` to yield parallel module names (same cardinality). If no `nameQuery`, module name = URL basename minus extension.
- Build `moduleName → url` index, cache it (like the GitHub tree index), then `fetchModule` = index lookup + fetch + validate. Relative URLs resolved against `catalogUrl`.
- Example the docs/UI should show: catalog `{"mibs":[{"name":"IF-MIB","file":"https://x/mibs/IF-MIB.txt"}, …]}` → `urlQuery: $.mibs[*].file`, `nameQuery: $.mibs[*].name`.

### 4. GitHub tree source
- Config: `{ owner, repo, branch, pathPrefix, token? }` — reuses plan 06's tree-index implementation (built-ins 3/5 are literally instances of this type, shown in the same list, non-deletable but reorderable/disableable). Optional token (SecretStore) lifts the 60 req/h Trees-API limit and enables private repos.

## Tasks

### T1 — Source implementations (`packages/resolver/src/sources/`)
`http-template.ts` (extend plan 06's with auth/headers), `ftp.ts`, `json-catalog.ts`, `github-tree.ts` (parameterize plan 06's). Config schemas as zod (or equivalent) validators — `config_json` in the `sources` table is validated on load; invalid → source auto-disabled with a visible error, never a crash.

### T2 — Sources manager UI
- Screen listing ALL sources (built-in + custom) in priority order: drag-to-reorder, enable/disable switches, per-source status (last used, last result, cache hit count), built-ins labeled and non-deletable.
- Add/edit flow: type picker → type-specific form (sensible defaults, inline help with examples for `@mib@` templates and JSONPath). Secrets masked, stored via SecretStore.
- **JSON catalog preview**: in the catalog form, a "Preview query" button fetches the catalog and shows the first 20 extracted `(name, url)` pairs live — this de-mystifies JSONPath for users and catches wrong queries before saving. Show raw-JSON snippet viewer to help users compose the path.
- **Test button** (all types): runs `source.test()` = end-to-end resolve of `SNMPv2-MIB` (configurable probe module — internal servers might not have standard MIBs; let the form override the probe name). Result: pass (latency, matched URL/variant) or fail with the exact stage (connect/auth/not-found/validation) and response excerpt.
- Import/export sources config as JSON (secrets excluded, marked as `"<set manually>"`) — teams share source lists.

### T3 — Chain integration
- Priority = list order across built-ins + customs; persistence in `sources` table; resolver (plan 06) reads the merged ordered chain. Per-source cool-down/backoff bookkeeping applies uniformly.
- Attribution strings in resolution logs use the user-given source name.

## Acceptance criteria
1. FTP: against a scratch vsftpd/pure-ftpd container (anonymous AND user/pass fixtures in `dev/`), a MIB resolves through `ftp://` source on desktop; on Android either the shimmed client works or the minimal client fallback is implemented — one of the two, verified on-device.
2. HTTP raw with basic auth: fixture server requiring auth → resolves with creds, fails cleanly with `SOURCE_AUTH_FAILED` without.
3. JSON catalog: fixture catalog (both shapes: URL-only and name+URL, plus relative URLs) → preview shows pairs, resolution works; malformed JSONPath → inline validation error at edit time, not runtime crash.
4. GitHub tree custom source pointed at a small public MIB repo resolves a module; with a token, a private repo works.
5. Reordering: put a custom source above the pysnmp corpus → resolution log proves it was tried first.
6. Export→wipe→import round-trips the source list (minus secrets).
7. All custom fetches demonstrably pass the content validator (HTML soft-200 fixture on a custom HTTP source is rejected).

## Test strategy
- Unit: config schema validation (good/bad per type), JSONPath extraction incl. cardinality mismatch between urlQuery/nameQuery (error), relative URL resolution, FTP path templating + variant order.
- Integration: fixture FTP container (docker-compose in `dev/`), fixture HTTP/JSON servers (extend plan 06's), chain-order test with request logging.
- Manual: one real-world bare FTP server and one real JSON catalog if available; else fixtures suffice — note it.

## Out of scope
SFTP/SCP sources (post-v1 if demanded), FTP directory browsing UI, WebDAV, source health monitoring/dashboards.
