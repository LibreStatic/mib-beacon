# MIB Beacon plan-completion audit

Audit date: 2026-07-13

Status: active — this is the evidence-backed queue for completing plans 00–10.

## Audit rules

- The current worktree, executable tests, produced artifacts, and external release state are authoritative.
- Plan prose and a `Status:` label are not proof that a requirement is complete.
- `Complete` means direct implementation and verification evidence exists.
- `Partial` means a usable slice exists but one or more named requirements are absent.
- `Unverified` means implementation may exist, but the required platform/runtime evidence does not.
- A checked item must link to current evidence in the final audit; no requirement may be silently deferred.

## Current checkpoint — local artifact rebuild and acceptance

- [x] Shared MIME registrations and globs exist for `.mib`, `.my`, and `.smi`; focused desktop,
      release-identity, and Flatpak packaging tests pass, and desktop typecheck passes.
- [x] The installed Flatpak exports the expected MIME handler, `xdg-mime` recognizes the files,
      and a real `gio launch` reaches the running application through the exported desktop entry.
- [x] The second Flatpak instance reads the document-portal file,
      transfers its bytes through Electron's single-instance payload, and the first instance's
      renderer retrieves the queued import through IPC.
- [x] The review modal is mounted at the application shell, so an OS-open request displays review
      without requiring the route-local Import panel to have been opened first.
- [x] The rebuilt Wayland Flatpak passed real `gio launch` review journeys for `.mib`, `.my`, and
      `.smi` and refreshed `docs/audits/flatpak-interactive.json` at `2026-07-13T22:41:20Z`.
      The audited Flatpak SHA-256 is
      `eeda5732f9871734ccd69b9962ac00573ee47e11cbcee42aa425964672e383b3`.
- [x] `.smi` is reported honestly as `application/smil+xml` on shared-mime-info Linux hosts. Flatpak
      strips application MIME magic and lowers custom glob priority, so the exported desktop entry
      claims both that host MIME and `text/x-smi`; strict local SMI validation rejects actual SMIL.
- [x] Rebuilt current x86_64/arm64 AppImage, deb, and rpm packages, regenerated immutable Flatpak
      source archives/manifest, and verified all 12 entries in the local desktop `SHA256SUMS` file.
- [x] Rebuilt the shared-code Android APK/AAB after forcibly regenerating the Metro release bundle,
      then passed APK v2/AAB JAR integrity, final-permission, and payload scans. APK SHA-256:
      `d351615031ed5b96dc71c3cb64c312ca4b93657b2c3d5a2d3b0bf4d407b35bea`; AAB SHA-256:
      `f2f1e2822a13c76924dfb84a562baa869a073f7efea3acfcbb81701a9d21051f`. The two-day
      self-signed verification-only key was deleted; its untrusted chain cannot satisfy strict
      publication validation and is not publication evidence.
- [x] At the post-logs artifact checkpoint, the rebuilt APK passed the complete scripted journey on
      the local Android 16 x86_64 emulator: cold install/start, five-tab navigation, real SNMP Get,
      1,761-row streamed Walk and cancellation, consent-gated online resolution, trap send, injected
      trap receive/persistence, and fatal/JavaScript logcat checks.
- [x] The 130% text sweep exposed and then verified the fix for Android status-bar overlap. The
      reproducible `dev/audit/android-accessibility-smoke/run.sh` retains a screenshot/UI tree,
      confirms all five navigation labels, activates the installed TalkBack service, performs a
      next-item focus gesture, and retains the active-service dump plus visible focus-ring screenshot.
- [x] Rebuilt every local desktop and Android output after the Plan 01 shared-core logs change. The
      12 desktop checksums, Linux deb/rpm/AppImage/Flatpak install-launch-uninstall audit, full
      Wayland Flatpak journey, Android signature/permission/payload checks, emulator acceptance, and
      accessibility smoke all pass against the hashes above.
- [x] `dev/audit/appimage-update-smoke/run.sh` built isolated `0.0.1-rc.1` and `0.0.1-rc.2`
      AppImages, served the generated generic-provider channel only on `127.0.0.1`, launched the
      real packaged rc.1 updater, downloaded and installed rc.2, restarted it, and recorded a
      `complete` marker. The installed SHA-256 exactly matches the feed rc.2; retained JSON/log
      evidence is under `docs/audits/appimage-update-smoke.*`.
- [x] `dev/audit/flatpak-update-smoke/run.sh` built isolated rc.1/rc.2 desktop payloads and OSTree
      commits, installed rc.1 from a filesystem-only user remote, updated it to rc.2, and launched
      both packages through the real Flatpak runtime. `ENGINE_READY` reported each expected version,
      the installed rc.2 commit exactly matched the repository head, and pre-existing user data was
      restored after cleanup; retained evidence is under `docs/audits/flatpak-update-smoke.*`.
- [x] `dev/audit/nsis-build-smoke/run.sh` completed an unsigned x64 NSIS cross-build under an
      isolated Wine 11.12 runtime and verified the NSIS/PE architectures, updater metadata, embedded
      application archive, unpacked-payload scan, and expected absent Authenticode directory.
      `docs/audits/nsis-build-smoke.json` records the 102,338,828-byte installer SHA-256
      `ea8265ccc2de315d392e647a9fade8972b53479147530f7ebc19a0acceaf2fc1`; this is structural
      Linux-host evidence, not a Windows 10/11 installation or runtime claim.
- [x] `pnpm audit:artifact-identity` directly inspected all 11 current local distributables and
      immutable Flatpak source archives. Both AppImages, both debs, both RPMs, the Flatpak, and both
      Flatpak sources carry the canonical MIB Beacon/LibreStatic/version/application identity; the
      APK and AAB compiled manifests carry `com.librestatic.mibbeacon`, `MIB Beacon`, and the beta
      version. All 12 desktop checksum entries still pass. The mobile files remain explicitly tied
      to the deleted verification-only key, so publication publisher identity is not inferred.
      Structured hashes and assertions are retained in `docs/audits/artifact-identity.json`.
- [x] Hosted release provenance gates now write Windows Authenticode, macOS
      signing/Gatekeeper/notarization, Android APK/AAB signer identity, and certificate digests to
      the workflow summary. After upload, the publish job downloads the GitHub release again,
      rejects any asset-name inventory difference, and strictly verifies the downloaded
      `SHA256SUMS`; release-metadata regression tests cover the workflow. These gates are
      implemented but remain unverified until the first credentialed tag run.
- [x] The signed Windows job now silently installs the produced NSIS, verifies its uninstall
      publisher/version, installed executable identity and Authenticode signature, all three file
      associations, main-window smoke markers, and clean uninstall. The notarized macOS job now
      verifies DMG bundle identity/version and launches the mounted application through the same
      main-window smoke. Both jobs retain package/signature logs for one day. All embedded Bash and
      PowerShell workflow programs parse; live target-host
      success remains unverified until GitHub runs them.
- [x] The hosted Linux jobs now execute the actual x86_64 AppImage through FUSE, install/launch/remove
      the amd64 deb, and install/launch/remove the Flatpak bundle, retaining all smoke logs for one
      day. The Flatpak filename now correctly uses the validated package version rather than
      `GITHUB_REF_NAME` with an erroneous leading `v`. All 44 Bash and 3 PowerShell workflow `run`
      blocks parse and 17 release-metadata tests pass; hosted execution remains unverified until a
      tag run.
- [x] Desktop release uploads now use a positive allowlist for public updater metadata
      (`latest-linux*.yml`, `latest.yml`, and `latest-mac.yml`) rather than broad YAML globs, so
      Electron Builder debug/effective configuration files cannot become public release assets.
- [x] README release guidance now distinguishes unsigned local/unofficial builds from the mandatory
      signed Windows and Developer ID-signed/notarized macOS tagged release paths. Its Linux
      low-port capability example targets the packaged executable at `/opt/MIB Beacon/mib-beacon`
      rather than the nonexistent `/usr/bin/mib-beacon`; release-metadata regressions enforce both
      corrections and the documented `pnpm audit:artifact-identity` command.
- [x] `pnpm audit:ubuntu-vm-appimage` boots an official-checksum Ubuntu 24.04.4 cloud image under
      KVM, installs only the documented runtime dependencies, transfers the current x86_64
      AppImage, proves host/guest SHA-256 equality, observes its real FUSE mount, requires
      `ENGINE_READY` and `SMOKE_MAIN_WINDOW_READY`, and verifies exit status zero plus mount cleanup.
      The same evidence records Ubuntu's unavailable unprivileged user namespace and the generated
      AppImage launcher's resulting `--no-sandbox` fallback. README now warns users to prefer
      Flatpak or native deb/rpm packages when process isolation matters; this limitation is not
      hidden by the successful launch result.

## Baseline evidence

- [x] `pnpm typecheck` passes for all workspace projects.
- [x] `pnpm lint` passes.
- [x] `pnpm verify:release-metadata` passes: 17 tests.
- [x] Full suite passes with localhost socket permission at the last full-suite checkpoint:
      80 files / 479 tests collected, 475 passed and 4 opt-in tests skipped by the default command;
      all 4 passed in their separate real FTP and Linux command fixture runs.
- [x] Electron production build succeeds.
- [x] LAN-server web production build succeeds.
- [x] Server bundle-size warning explicitly accepted for the beta with measured startup evidence:
      the renderer-safe SMI entry removed `net-snmp`/Node built-ins from the browser graph; the
      feature-complete web bundle is 1,028.26 kB minified / 272.31 kB gzip and reached an HTTP 200
      in 892 ms on this host. Route-level splitting remains a post-beta optimization.
- [x] Fresh full-suite rerun after the packaged Flatpak resolver/accessibility work: 80 files / 479
      tests collected, 475 passed and 4 skipped, plus the 4 opt-in fixture tests in separate enabled
      runs. Typecheck, lint, release metadata, license audit, artifact scans, Electron build, and LAN
      web build also pass at this checkpoint.
- [x] Fresh post-association full-suite checkpoint: 80 files / 483 tests collected, 479 passed and
      4 opt-in tests skipped by default; the 2 FTP fixture tests and 2 real Linux command tests all
      pass in separate enabled runs. Workspace typecheck, lint, release metadata, license audit,
      payload scans, checksum verification, and the complete Linux package smoke also pass.
- [x] Fresh post-rebuild Android checkpoint: Gradle rebuilt the APK/AAB from a forced current Metro
      bundle; APK v2 and AAB JAR signatures verify, the merged manifest contains only `INTERNET` plus
      the application-scoped dynamic-receiver permission, payload scans pass, the temporary key is
      gone, and `dev/audit/android-release-smoke/run.sh` passes on `emulator-5554`.
- [x] Fresh post-accessibility-fix suite: 81 files / 486 tests collected, 482 passed and the same 4
      opt-in fixture tests skipped by default; zero failures. Workspace typecheck, lint, focused
      formatting, mobile safe-area regression tests, APK/AAB signature/permission/payload checks,
      core emulator smoke, and Android accessibility smoke all pass at this checkpoint.
- [x] Fresh post-logs-domain suite: 83 files collected, 81 passed and 2 opt-in files skipped; 494
      tests collected, 490 passed and the 4 opt-in fixture tests skipped by default. Both FTP fixture
      tests and both real Linux reachability-command tests pass separately. Workspace typecheck and
      lint pass. The run also exposed an arbitrary-sleep race in the resolver consent-expiry test;
      its state-based replacement passed five isolated repetitions and the subsequent full suite.
- [x] Fresh post-updater-contract suite: 84 files collected, 82 passed and 2 opt-in files skipped;
      499 tests collected, 495 passed and the 4 opt-in fixture tests skipped by default. The added
      five-test contract proves explicit opt-in, rc.1→rc.2 derivation, download/install marker flow,
      restarted rc.2 completion evidence, and rejection of a non-consecutive provider response.
      Authoritative workspace typecheck and lint also pass.

Restricted sandboxes cannot bind the localhost sockets used by transport, HTTP, MIB URL,
and notification integration tests. `EPERM listen/bind 127.0.0.1` is an environment failure;
authoritative suite runs must allow local TCP/UDP sockets.

## Immediate correctness and privacy defects

- [x] **Resolver fresh-install defaults:** disable both the resolver and automatic missing-import
      resolution until the user opts in. Regression coverage added in
      `packages/core/src/resolver-engine.test.ts`.
- [x] Make the resolver master switch gate every external source test, preview, explicit module
      resolution, and network OID lookup; a regression test proves source test, preview, and network
      OID lookup terminate with `RESOLVER_DISABLED` and make zero HTTP requests before opt-in.
- [x] Map HTTP 401/403 source failures to `SOURCE_AUTH_FAILED` with source, module,
      `fetch` stage, and HTTP-status evidence; HTTP template, JSON catalog, and GitHub tree
      sources now preserve authentication statuses.
- [x] Fix trap receiver startup so completion means the UDP bind actually succeeded; occupied
      ports now reject as `SOCKET_ERROR`, failed sockets close safely, and node hosts default to
      162 with an EACCES-only fallback to 1162 using structured `PORT_BIND_DENIED` mapping.
- [x] Persist malformed trap packets as inspectable `parse_error` records with raw bytes; receiver
      and restart/query tests prove the record remains visible rather than only being logged.
- [x] Replace the last `EngineAPI` stub with an in-memory 1,000-entry logs ring: runtime levels,
      exact/minimum-level, time, search, and latest-limit queries, `logs` events, JSONL export,
      bridge/proxy support, malformed-filter rejection, and credential redaction all have focused
      regression coverage. Logs are deliberately not written to SQLite.

## Plan-by-plan task matrix

### Plans 00–02 — vision, architecture, and spike

| Requirement                                      | State                        | Current evidence / missing proof                                                                                                                                        |
| ------------------------------------------------ | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plan 00 reference document                       | Complete as reference        | It is not an accurate implemented-feature checklist; current gaps below still apply.                                                                                    |
| Shared TypeScript monorepo and platform adapters | Complete                     | Desktop, mobile, server, core, transport, resolver, app, and UI projects exist.                                                                                         |
| Renderer-safe engine boundary                    | Complete                     | Proxy/bridge, Electron sandbox, context isolation, and CSP are implemented.                                                                                             |
| Final EngineAPI surface                          | Complete                     | Agents, groups, operations, traps, resolver, tools, and the in-memory logs/query/level/export domain are implemented; no `StubDomain` remains.                          |
| Final persistence schema                         | Complete for v1              | MIB/resolver, agent/group, bookmark/snapshot, trap/rule, poll/watch/chart, and settings migrations are present and restart-tested.                                      |
| S1 desktop Get and S2 crypto matrix              | Complete per recorded spike  | Re-run during final platform audit.                                                                                                                                     |
| S3 Android Get                                   | Complete on release APK      | Pixel 9 Pro Android 16 emulator performed a real Get against the host fixture through `10.0.2.2:1611`; scripted evidence is retained.                                   |
| S4 trap receive on both hosts                    | Complete on desktop/emulator | Automated desktop coverage plus host-to-emulator UDP redirection proved release-APK Android receive and persistence; physical-device behavior remains release evidence. |
| S5 1,000-row streaming walk on both hosts        | Complete on desktop/emulator | Desktop streamed 1,761 varbinds in 89 batches; the rebuilt release APK repeated 1,761/89 on Android and separately proved cancellation against an unanswered UDP port.  |
| Fresh clone and remote CI                        | Unverified                   | Local gates pass; there is currently no configured remote/repository to prove CI state.                                                                                 |

### Plan 03 — MIB catalog and parser

| Task                          | State    | Completion checklist                                                                                                                                                                                                                          |
| ----------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1 corpus harness             | Complete | [x] pinned netdisco/librenms lock [x] fetch script [x] timeout-bounded worker run [x] JSON report [x] `pnpm corpus` [x] recorded rates/timings                                                                                                |
| T2 parse pipeline             | Complete | [x] normalization diagnostics [x] structured file/line/module/symbol core errors [x] bounded recoveries [x] between-file yield/progress [x] diagnostics UI contract [x] isolated timeout-bounded worker evidence                              |
| T3 lenient recovery catalogue | Complete | [x] omitted enterprises/wrong-provider Counter64 imports [x] underscore/uppercase identifiers [x] DESCRIPTION sanitation [x] identity/macro mixing [x] truncated END [x] duplicate OIDs [x] partial-object recovery                           |
| T4 table/index semantics      | Complete | [x] INDEX/IMPLIED fixture [x] AUGMENTS fixture [x] TC chains [x] DISPLAY-HINT formatter/MAC/IP/date fixtures [x] 5,427-file corpus audit [x] composite/fixed/variable/IMPLIED instance decoder                                                |
| T5 engine/catalog             | Complete | [x] revision/organization/object-count metadata [x] private content-addressed persistence [x] bidirectional translate with instance suffixes [x] exact/prefix/fuzzy/OID/description ranking [x] highlight spans [x] bounded performance tests |
| T6 UI                         | Complete | [x] diagnostics viewer/copy [x] full module/node/table/TC properties [x] multi-select/context actions [x] access/read-write state [x] Ctrl-F/Command-F search focus [x] operation/Table View actions                                          |

Automated proof covers broken-MIB partial recovery, exact/prefix translation, fuzzy search budgets,
restart persistence, index semantics, and a 98.64% ok-or-recovered corpus run. Packaged full-corpus
responsiveness and restart observation on desktop and physical Android remain release evidence.

### Plan 04 — agents, operations, and Table View

| Task                      | State    | Completion checklist                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1 agent profiles/groups  | Complete | [x] encrypted CRUD/ref-only API [x] v1/v2c/v3 profile model [x] sysDescr/upTime/objectID test + existing v3 error mapping [x] group CRUD [x] last-used engine ordering [x] validation matrix/DES/AES gating [x] manager/quick picker UI [x] saved-target credentials stay inside engine                                                                                                                                                 |
| T2 operations engine      | Complete | [x] Get/GetNext/GetBulk/Set/Walk [x] generic start/cancel [x] subtree/table fetch kinds [x] per-target reuse/serialization [x] ≤50-row streamed batches + timing/count/PDU stats [x] 100k hard cap/non-increasing guard [x] MIB DISPLAY-HINT/enum/units formatting + lossless raw values                                                                                                                                                |
| T3 operations UI          | Complete | [x] titled select/pin/close result tabs [x] group picker/mode + Agent column/status chips [x] credential-redacted decoded PDU drawer [x] symbolic/module-qualified OIDs [x] cross-platform CSV/JSON with formatted+raw values [x] private persistent snapshots + reopen [x] saved-agent bookmarks + rerun [x] Get/Set/Inspect/Copy row actions [x] Ctrl/Cmd operation/stop + Enter repeat shortcuts                                     |
| T4 Set                    | Complete | [x] numeric/counter/Counter64/OCTET STRING text+hex/OID/IpAddress/BITS/TimeTicks editors [x] MIB enum chips/range validation/DISPLAY-HINT guidance [x] atomic multi-varbind staging/single PDU [x] current-value fetch + old-to-new confirmation [x] offending row/OID error mapping                                                                                                                                                    |
| T5 multi-agent operations | Complete | [x] default-5/max-20 bounded fan-out [x] agent-tagged streaming [x] per-agent error isolation + aggregate completion [x] group picker/status UI [x] deterministic concurrency proof [x] real 2-live/1-unreachable node-net-snmp UDP fixture proof                                                                                                                                                                                       |
| T6 Table View             | Complete | [x] composite/IMPLIED/display-hint decoded indexes [x] sparse streamed row assembly [x] group Agent dimension [x] poll + 1.2s changed-cell flash [x] rotate/column-subset refetch/CSV [x] writable-cell Set prefill [x] per-index RowStatus create wizard + createAndGo/createAndWait fallback + destroy(6) [x] bounded FlatList row virtualization + 10k-row proof [x] real RowStatus create/required-column/destroy UDP fixture proof |

Automated and real UDP fixture proof covers all six functional criteria, including v3 mappings,
stream/cancel/export, Table View polling and RowStatus, one-unreachable group isolation, and bookmark
round trips. Physical Android and independent real-device journeys remain release evidence.

### Plan 05 — trap receiver and sender

| Task               | State    | Completion checklist                                                                                                                                                                                                                                    |
| ------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1 receiver engine | Complete | [x] udp4+udp6 attempt with safe udp4 fallback and 162→1162 permission fallback [x] encrypted v3-user CRUD [x] v1/v2c/v3 decode + NOTIFICATION OBJECTS conformance [x] raw malformed/unknown-user persistence [x] SQLite 50k ring pruning                |
| T2 receiver UI     | Complete | [x] virtualized live/persisted list and detail [x] time/source/trap/version/varbind/unread query [x] read/unread + nav badge [x] single/filtered text/CSV/JSON [x] saved filters [x] bound transports/count/drops + raw hex                             |
| T3 sender          | Complete | [x] v1/v2c/v3 trap + v2c/v3 inform [x] typed payload and NOTIFICATION prefill [x] credential-free saved-agent presets [x] replay received/send-again history [x] explicit v1 enterprise/generic/specific mapping [x] real v1/v2c/v3/inform UDP evidence |
| T4 rule foundation | Complete | [x] schema/types/stubbed post-v1 actions [x] OID/source/varbind matching [x] severity/color persistence [x] receive evaluation hook [x] renderer OS-notification event [x] post-v1 sound/exec/forward disabled in UI                                    |

Automated proof now covers v1 standard and enterprise-specific traps, v2c trap/inform ack,
configured v3 and unknown-user visibility, malformed raw datagrams, decoded OBJECTS diagnostics,
restart persistence, pruning, a 10k-record search under the 500 ms budget, and severity/notification
rule events. The release-APK emulator now adds host→Android receiver persistence and Android→host
sender delivery evidence. The packaged Wayland Flatpak additionally emitted an observed
`org.freedesktop.Notifications.Notify` call for a real breached watch. Manual release evidence still
needs physical-device foreground/background behavior and real non-root port-162/setcap fallback.

### Plans 06–07 — online and custom resolution

| Requirement                                 | State                                 | Current evidence / missing proof                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recursive dependency resolver/cache/consent | Complete (automated)                  | Recursive closure, staged atomic load, attribution, consent, cancellation, offline replay and cache persistence have engine coverage.                                                                                                                                                                                               |
| No external request before opt-in           | Complete (automated)                  | Fresh-install regression covers source test, preview and online OID lookup with the master switch off and asserts zero HTTP calls.                                                                                                                                                                                                  |
| Built-in source set and attribution         | Complete                              | Documented chain includes both Cisco endpoints; lookup includes the non-scraping Observium link-out.                                                                                                                                                                                                                                |
| Content validation                          | Complete                              | Size/type/HTML/header checks exist; a valid response declaring a different module is accepted with a source-attribution warning as required.                                                                                                                                                                                        |
| OID lookup                                  | Complete (automated)                  | Loaded/cache evidence, 30-day IANA registry cache, serialized ≥1s oid-base access, candidate fetch, cache-only load and Observium actions tested.                                                                                                                                                                                   |
| Custom source implementations               | Complete (automated)                  | HTTP template, passive FTP/Node FTPS, JSON catalog and GitHub tree implementations have unit/integration coverage.                                                                                                                                                                                                                  |
| HTTP template behavior                      | Complete for placeholder/append modes | Validation now accepts both `@mib@` templates and base URLs that append bounded filename variants; both modes have regression coverage.                                                                                                                                                                                             |
| Authentication errors                       | Complete                              | Source tests map HTTP 401/403 to `SOURCE_AUTH_FAILED` at the `auth` stage.                                                                                                                                                                                                                                                          |
| Sources manager UI                          | Complete                              | Pointer/touch drag plus arrow fallback, usage stats, raw 4 KiB JSON snippet, and exact failure stage/status/excerpt are implemented.                                                                                                                                                                                                |
| Required external/platform evidence         | Complete on desktop/emulator          | [x] automated fresh-install no-network proof [x] order request log [x] reproducible FTP fixture [x] anonymous+authenticated fixture execution (2 tests) [x] reproducible live-source recheck: all 7 enabled sources found their test module [x] release-APK Android consent disclosure, IF-MIB fetch/validation, and opt-out reset. |

Plans 06 and 07 now distinguish automated implementation completion from the remaining release-time
platform evidence, so those checks are visible rather than silently deferred. The opt-in
`pnpm audit:live-resolver` report is retained at `docs/audits/live-resolver-sources.json`; the seven
enabled sources passed, while disabled Circitor correctly remained excluded after returning HTML
instead of a MIB.

### Plan 08 — tools suite

| Task                   | State                                             | Current evidence / missing proof                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1 polling foundation  | Complete (automated)                              | Migration-backed series/samples; fresh-state scheduler batching; persisted backoff/degraded state; non-overlap guard; retention/vacuum; exact Counter32/64 wrap; restart history and CSV tests.                                                                                                                                                                                                           |
| T2 graphs              | Complete (automated + packaged visual/export)     | Responsive custom SVG multi-series charts, history, axes, nearest tooltip, legend toggles, theme colors, saved charts, PNG and CSV actions. A real Flatpak SNMP sample rendered in the retained dark-theme screenshot; the tooltip and named PNG download were exercised and the retained PNG's signature, length, and themed rendering were inspected. Android sharing remains physical-device evidence. |
| T3 watches             | Complete (automated + packaged notification)      | Persisted cards/stats/sparklines, raw/derived thresholds, transition-only alert event, and host Notification mapping. A real Flatpak `sysUpTime` breach emitted an observed `org.freedesktop.Notifications.Notify` call with the expected title.                                                                                                                                                          |
| T4 discovery           | Complete (automated + real UDP desktop)           | CIDR/range bounds, concurrency, immediate cancellation, saved/ad-hoc credential handling, mobile cap, optional desktop pre-ping, save/open actions; three-agent/different-community UDP fixture passes. Android run remains manual.                                                                                                                                                                       |
| T5 compare             | Complete (automated + real UDP)                   | Streaming/cancellable live diff, saved snapshot diff, numeric snmpwalk parser, OID/name alignment, difference filter and CSV; seeded UDP difference fixture passes.                                                                                                                                                                                                                                       |
| T6 port view           | Complete (automated + real UDP fixture)           | HC/32 fallback, speed-zero behavior, rates/utilization/errors, status filter/sort, details/sparklines/graph actions; real ifTable/ifXTable UDP fixture proves exact rate math. Independent physical-device sanity remains manual.                                                                                                                                                                         |
| T7 reachability        | Complete (Linux actual; cross-platform automated) | Shell-free platform args, count/Unix interval, streamed output, Unix/Windows summaries, cancel, tracepath fallback, explicit mobile SNMP decision; actual Linux ping+tracepath passes. macOS/Windows host runs remain manual.                                                                                                                                                                             |
| Cross-tool conventions | Complete (automated)                              | Standard handle/event streaming, immediate idempotent cancellation, independent scheduler group in-flight guards, and focused unit/integration coverage.                                                                                                                                                                                                                                                  |

Plan 08 implementation is complete. Packaged desktop chart rendering, tooltip, PNG export, and
OS-notification delivery are now retained evidence. Remaining checks are explicitly
platform/manual release evidence: physical Android flow/sharing, independent physical-device port
sanity, and macOS/Windows host execution.

### Plan 09 — responsive UX, themes, and accessibility

| Task                 | State                                                                                                     | Completion checklist                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1 layout shells     | Complete (automated)                                                                                      | [x] exact 640/1024 boundaries [x] persisted desktop splits/rail [x] tablet portrait drawer/landscape pin [x] phone stack/FAB/five tabs [x] web/native deep links [x] tools/results composition [x] resize-state architecture/tests.                                                                                                                                                                                                                                                |
| T2 input affordances | Complete (automated)                                                                                      | [x] DnD import [x] accurate `?` overlay [x] keyboard tree/splits [x] right-click/long-press parity [x] trap/tab swipes with accessible actions [x] tree/trap pull refresh [x] shared density touch targets [x] rail hover hints.                                                                                                                                                                                                                                                   |
| T3 themes/polish     | Complete (automated)                                                                                      | [x] system/manual theme [x] semantic status/diff/severity/focus tokens [x] auto/manual density [x] original SVG + desktop/Android launcher assets.                                                                                                                                                                                                                                                                                                                                 |
| T4 accessibility     | Substantial (automated + packaged AX + Android emulator)                                                  | [x] shared roles/labels/states/focus [x] keyboard operations [x] WCAG AA token tests [x] text/icons accompany colors [x] shared-control 130% scaling/middle OID ellipsis [x] packaged Chromium accessibility trees for Browse/Query/Traps with required semantic names [x] Android 130% release-APK screenshot/UI-tree sweep [x] active TalkBack next-item focus traversal on emulator [ ] independent human screen-reader observation.                                            |
| T5 full audit sweep  | Browser visual and packaged desktop keyboard runs complete; emulator evidence accepted for this host goal | [x] reproducible 42-capture runner/matrix [x] archived seven routes × three viewports × two themes [x] 92 named-control/overflow/route/shortcut/error checks [x] representative manual image inspection [x] packaged keyboard native import, explicitly opted-in missing-dependency resolution, search, Get, 1,761-row Walk, Table View, trap receive, settings [x] Android release APK emulator journey selected by the user; physical phone/tablet is optional release evidence. |

Plan 09 code, automated acceptance, and the browser visual matrix are complete. The retained audit
contains 42 screenshots with zero console/in-page engine errors and 92 passing runtime checks.
The packaged Flatpak audit additionally captures direct accessibility trees and the complete desktop
keyboard core journey, including Table View and explicitly opted-in external dependency resolution.
The rebuilt Android release now has retained 130% text and active TalkBack focus evidence on the
emulator. Independent human screen-reader observation remains optional physical-device evidence
beyond this host goal and is not inferred from the automated focus traversal.

### Plan 10 — packaging, compliance, and release

| Task                 | State                                                                | Completion checklist                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1 desktop packaging | Implemented; platform evidence partial                               | [x] AppImage/deb/rpm/NSIS/dmg/Flatpak definitions [x] manual/opt-in updater [x] tagged jobs require credentials and verify Authenticode/Developer ID/Gatekeeper/notarization [x] hosted AppImage/deb/Flatpak package execution gates retain evidence [x] hosted NSIS install/identity/association/launch/uninstall and mounted-DMG identity/launch gates retain evidence [x] MIME globs and real `gio`/desktop-entry forwarding [x] `.mib`/`.my`/`.smi` all display import review after IPC handoff [x] immutable Flatpak sources [x] local AppImage/deb/rpm/Flatpak builds [x] direct identity/publisher/version/hash inspection of all current Linux artifacts and Flatpak sources [x] reproducible fresh Ubuntu/Fedora container checks plus forced-X11 and native-Wayland Flatpak launches [x] clean Ubuntu 24.04 KVM AppImage FUSE/hash/main-window/cleanup proof with explicit no-sandbox disclosure [x] real Wayland portal-selected import/review/load and theme/density plus imported-MIB persistence across graceful restart [x] real local rc.1→rc.2 AppImage download/install/restart/hash proof [x] real local Flatpak rc.1→rc.2 OSTree install/update/version/commit proof [x] unsigned NSIS x64 cross-build/PE/updater-metadata/payload structural proof under isolated Wine [ ] live signed hosted run and Windows/macOS target-platform installs and updates |
| T2 mobile packaging  | Implemented; publication credential/hosted build gated               | [x] environment-only release signing/no debug fallback [x] final merged-manifest permission allowlist [x] preview APK/production AAB profiles [x] conservative OTA policy [x] direct compiled APK/AAB application-id/name/version inspection [x] rebuilt local release APK install/five-tab/SNMP Get/Walk/cancel/online-resolution/trap send+receive emulator evidence [x] unsigned IPA CI packaging [ ] real Android publication signing [ ] hosted macOS IPA build inspection; physical iOS validation is waived on this host                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| T3 release pipeline  | Implemented; local Linux updater paths proven, hosted run unverified | [x] build matrix/inventory/checksums/one-day retention/500 MB housekeeping [x] public release-metadata allowlist excludes builder debug/effective configs [x] hosted signing/notarization summary evidence [x] post-upload exact inventory and downloaded-checksum verification [x] xvfb Electron smoke [x] Android emulator release-network smoke [x] pre-publication payload scans [x] rc2 jobs install matching rc1 AppImage/NSIS and retain restarted-version evidence [x] five local updater contract tests cover consecutive version selection and restarted marker completion [x] real local AppImage rc.1→rc.2 download/install/restart with feed/installed hash equality [x] real local Flatpak repository rc.1→rc.2 update with installed-commit equality [ ] live version tag/prerelease and hosted AppImage/NSIS rc1→rc2 runs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| T4 GPL/compliance    | Complete (automated)                                                 | [x] About/exact-tag source [x] generated dependency-license inventory and incompatibility/unknown gate [x] expanded vendor-MIB/secret scan [x] contribution/security/issue templates                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| T5 release docs      | Complete                                                             | [x] README install/setup/release links and warning [x] tagged public Windows/macOS signing requirements distinguished from unsigned local builds [x] installed Linux capability path verified [x] custom-source examples [x] FAQ [x] update/signing/store docs [x] release notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

Current external state still does not prove a publishable release: there is no successful hosted tag
run with real signing credentials. Local evidence now includes x86_64/arm64 AppImage, deb, and rpm
packages, an immutable-source x86_64 Flatpak, updater metadata, and verified checksums. Fresh
Ubuntu 24.04/Fedora 42 container runs proved deb/rpm install-launch-uninstall and a real-FUSE
AppImage launch; host-user Flatpak forced-X11 and native-Wayland install-launch-uninstall runs also
passed. A native KDE `org.freedesktop.portal.FileChooser.OpenFile` selection imported
`FIXTURE-MIB`, and both the imported module and dark/comfortable settings survived a graceful
Flatpak restart; reproducible JSON and screenshot evidence are retained in `docs/audits/`.
Windows/macOS target-host execution, arm64 execution, signed NSIS installation/update, dmg,
unsigned IPA, and public release publication still require their target platforms or hosted
workflow. The unsigned x64 NSIS cross-build now completes locally under an isolated Wine 11.12
runtime and passes PE type, embedded payload, updater metadata, payload scan, and absent-
Authenticode structural assertions; this is explicitly not a Windows 10/11 runtime result.
Android APK/AAB local outputs were rebuilt from the current forced
Metro bundle with a two-day, self-signed verification-only key, passed final permission/payload
scans, signature verification, and the complete Android 16 emulator journey, and are explicitly
never publication evidence; the temporary key was deleted after verification.

The refreshed Flatpak audit now includes real file-association acceptance for all three extensions,
in addition to the retained portal, keyboard, SNMP, accessibility, chart, notification, and restart
journeys. All locally produced Linux formats, the desktop checksum inventory, and the shared-code
Android APK/AAB have since been rebuilt; the Android emulator acceptance rerun also passes.
The artifact-identity audit now proves the canonical identity from the package contents rather than
only their build configuration. Hosted NSIS/dmg/IPA identity, Android release-publisher signing, and
uploaded checksum equality remain publication-time evidence and are still unchecked.
The hosted workflow now gathers those signing identities and re-downloads the published release for
an exact inventory/checksum comparison; no success is claimed until a real credentialed tag executes
that path.

## Prioritized implementation queue

1. Supply release signing credentials, push the version tag, and record the hosted workflow/release,
   including the unsigned device IPA build and archive inspection on the macOS runner. Physical iOS
   installation is explicitly waived for this Linux-host goal.
2. Exercise the remaining rc1→rc2 paths (hosted GitHub-backed AppImage and signed NSIS) plus clean
   target-platform installs before declaring a release candidate complete. The real localhost-fed
   AppImage and local OSTree Flatpak repository paths now pass, and the unsigned x64 NSIS cross-build
   passes structural inspection in `docs/audits/nsis-build-smoke.json`; only real Windows can close
   its installation/runtime/update gate. A fresh official Ubuntu 24.04.4 image now also passes the
   x86_64 AppImage smoke under KVM with retained FUSE/hash/main-window evidence. The VM audit records
   rather than conceals the AppImage launcher's `--no-sandbox` fallback under Ubuntu's default
   user-namespace restriction. Windows/macOS and arm64 execution remain target-host/hosted evidence.

## External and credential-gated evidence

The following cannot be claimed complete from configuration alone:

- GitHub repository/tag/release publication and hosted Actions success.
- Windows code signing and SmartScreen reputation.
- Apple Developer ID desktop signing/notarization and the hosted unsigned IPA build/archive check;
  physical iOS installation and signed iOS/TestFlight distribution are outside this host's goal.
- Play Store and Flathub publication.
- Manual physical-device SNMP and Android phone/tablet runs remain optional release evidence beyond
  this host goal; clean Windows/macOS acceptance still requires those target platforms or hosted VMs.

If credentials or external accounts remain unavailable, the final record must name the exact missing
credential, retain reproducible build/verification commands, and distinguish `credential-gated` from
implemented and verified work.
