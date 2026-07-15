# Release checklist

This checklist is completed for each release candidate. Checked automated-readiness items below
mean the implementation/gate exists and passed locally; they do **not** replace the unchecked
clean-platform, real-credential, publication, or update-path observations.

## Automated readiness (2026-07-13 local evidence)

- [x] Canonical version/tag metadata and generated engine/About identity are consistent.
- [x] Production dependency licenses are generated and rejected if unknown or incompatible.
- [x] Desktop updater, opt-in automatic checks, and `.mib`/`.my`/`.smi` review routing have tests.
- [x] Android release signing requires environment credentials and has no debug release fallback.
- [x] The final merged Android release manifest passes the explicit permission allowlist.
- [x] Release payload scanning rejects vendor MIBs, sensitive filenames, private keys, and common tokens.
- [x] Immutable x86_64/aarch64 Flatpak sources and checksums are generated and tested.
- [x] Release CI defines Linux/Windows/macOS/Android/iOS builds, Electron xvfb smoke, Android
      emulator smoke, one-day artifact retention, checksums, prerelease publication, and storage
      housekeeping.
- [x] Manual tagged runs expose independent AppImage, deb, rpm, Flatpak, NSIS, dmg, APK, AAB,
      and IPA toggles; tag pushes still select the complete production inventory.
- [x] Tagged desktop jobs refuse missing Windows/macOS signing credentials and verify Authenticode,
      Developer ID, Gatekeeper assessment, and the stapled notarization ticket; Android CI verifies
      the APK and AAB signatures before upload.
- [x] A tagged `-rc.2` publication automatically downloads and installs the matching `-rc.1`
      AppImage and NSIS builds, invokes the explicit updater smoke, and retains restart/version
      evidence; a live rc2 run is still required before checking the update-path item below.
- [x] Local Linux builds produced x86_64/arm64 AppImage, deb, and rpm packages, and an
      x86_64 Flatpak. `pnpm audit:linux-packages` reproducibly passed fresh Ubuntu 24.04 deb and
      FUSE AppImage launches, a fresh Fedora 42 rpm install/launch/uninstall, and Flatpak X11
      install/launch/uninstall. The rebuilt Flatpak also passed a native Wayland-only launch on this
      host. A separate Wayland audit completed a real KDE portal file selection/import and proved
      imported-MIB plus theme/density persistence across a graceful restart; clean VMs remain.
- [x] A local verification-only Android build produced APK/AAB, passed the final permission and
      artifact scans, and verified its APK v2/AAB JAR signatures; the temporary self-signed key was
      deleted and these outputs are not publishable release artifacts.
- [x] The rebuilt release APK installs and cold-starts on the local Pixel 9 Pro Android 16 emulator;
      all five phone tabs render, a real SNMP Get reaches the host fixture, an explicitly consented
      mibbrowser.online source test fetches and validates IF-MIB, a trap send reaches the fixture's
      UDP socket, a host-injected trap is persisted by the Android receiver, and logcat has no
      JavaScript/fatal runtime exception. The full check is reproducible with
      `dev/audit/android-release-smoke/run.sh path/to/app-release.apk`.
- [x] A reproducible local AppImage updater audit builds isolated rc.1/rc.2 packages, exposes the
      generated feed only on localhost, performs the real download/install/restart, and proves the
      restarted completion marker plus feed/installed SHA-256 equality. Evidence is retained in
      `docs/audits/appimage-update-smoke.json` and `.log`; the hosted GitHub-provider run remains.
- [x] A reproducible Flatpak updater audit builds distinct rc.1/rc.2 OSTree commits in an isolated
      filesystem remote, installs and launches rc.1, performs the real `flatpak update`, launches
      rc.2, and proves repository/installed commit equality while preserving pre-existing app data.
      Evidence is retained in `docs/audits/flatpak-update-smoke.json` and `.log`.
- [x] A reproducible Linux-to-Windows audit cross-builds the unsigned x64 NSIS installer under Wine,
      verifies the NSIS and PE architectures, updater metadata, embedded application archive,
      unpacked-payload scan, and expected absence of an Authenticode security directory. Evidence is
      retained in `docs/audits/nsis-build-smoke.json` and `.log`; this does not claim a Windows
      installation/runtime or publication-ready signing result.
- [x] `pnpm audit:artifact-identity` directly inspects both AppImages, both debs, both RPMs, Flatpak,
      both immutable Flatpak sources, APK, and AAB for their compiled/package identity and records
      exact hashes in `docs/audits/artifact-identity.json`. Linux packages name LibreStatic; mobile
      package identity passes but publisher signing remains gated by the unavailable release key.
- [x] The hosted workflow is configured to record Windows, macOS, and Android signing identities and
      certificate digests in its summary, then download the published release and require exact
      asset-name parity plus strict `SHA256SUMS` verification. The corresponding live-result boxes
      remain unchecked until a credentialed tag actually executes these gates.
- [x] The hosted Windows job is configured to install the signed NSIS, verify installed
      publisher/version/signature and `.mib`/`.my`/`.smi` registrations, launch the installed main
      window, and uninstall it. The macOS job verifies mounted-DMG bundle identity/version and
      launches the packaged main window. Logs are retained for one day; real target-host results
      remain unchecked below until the jobs execute.
- [x] Hosted Linux jobs are configured to execute the x86_64 AppImage through FUSE, install and
      exercise the amd64 deb, and install and exercise the Flatpak bundle before clean removal. The
      Flatpak artifact now follows the canonical versioned filename without a tag-only `v` prefix.
      Evidence logs are retained for one day; hosted results remain unchecked until execution.
- [x] Desktop workflow artifacts allowlist only the platform updater metadata intended for release;
      Electron Builder debug and effective-configuration YAML files are excluded from publication.
- [x] The current x86_64 AppImage passes a reproducible official Ubuntu 24.04.4 KVM guest smoke:
      host/guest hashes match, a real FUSE mount is observed and released, both readiness markers
      appear, and the application exits zero. The retained report also records the default Ubuntu
      user-namespace denial and AppImage `--no-sandbox` fallback; README recommends Flatpak or a
      native package where process isolation matters.
- [x] README installation guidance requires signing/notarization for tagged public Windows/macOS
      releases while labeling unsigned local builds separately, and its Linux `setcap` example uses
      the packaged `/opt/MIB Beacon/mib-beacon` executable. Release-metadata tests enforce these
      documentation contracts.
- [x] The Plan 09 browser audit archived 42 light/dark screenshots across phone/tablet/desktop and
      passed 92 route, shortcut, named-control, overflow, console-error, and in-page-error checks.
- [x] The packaged Wayland Flatpak accepted real native portal selections and completed import,
      explicitly opted-in external dependency resolution, search shortcut, real SNMP Get, a
      1,761-row Walk, Table View, trap receive, and settings using the keyboard; retained Chromium
      accessibility trees name Browse, Query, and Traps controls meaningfully. Human screen-reader
      observation remains a separate manual gate.
- [x] The packaged Flatpak uses the host Secret Service for encrypted saved credentials; a saved
      fixture agent sampled a real chart, exercised its tooltip and valid themed PNG export,
      breached a watch, and emitted the expected desktop notification call. Retained image and JSON
      evidence live under `docs/audits/`.
- [ ] Hosted tag workflow succeeds with publication credentials and all target-platform artifacts.
- [ ] Android APK/AAB are signed with the release key rather than a temporary verification key.

## Identity and compliance

- [ ] Every **hosted release** artifact identifies as `com.librestatic.mibbeacon` and names
      LibreStatic as publisher; all current local Linux/mobile package identities pass, but hosted
      NSIS/dmg/IPA and Android release-key publisher identity do not exist yet.
- [x] `pnpm verify:release-metadata`, typecheck, lint, and the full test suite pass.
- [x] GPL license and third-party notices are present; no vendor MIBs or secrets are bundled.
- [ ] SHA-256 checksums match every uploaded artifact.
- [ ] The tag matches the canonical package version (initial beta: `v0.0.1-beta.1`).

## Desktop packages

- [x] AppImage launches on a clean Ubuntu 24.04.4 KVM guest through FUSE with matching artifact
      hash, main-window readiness, clean exit, and mount cleanup; the observed `--no-sandbox`
      fallback is disclosed rather than treated as sandboxed execution.
- [x] deb and rpm install, launch, and uninstall cleanly in fresh Ubuntu 24.04 and Fedora 42
      userspaces; clean full-VM journeys remain part of the broader platform audit.
- [x] Flatpak launches under Wayland and X11, persists settings and imported MIBs across a graceful
      restart, and accesses a native user-selected file through `org.freedesktop.portal.FileChooser`;
      `pnpm audit:flatpak-interactive` retains JSON and screenshot evidence.
- [ ] NSIS installs on Windows 10/11; dmg opens on supported macOS versions.
- [x] `.mib`, `.my`, and `.smi` files enter the import-review flow through real packaged `gio`
      launches; Linux reports `.smi` as the shared `application/smil+xml` type claimed by the app.
- [x] Packaged MIB import, Browse, SNMP query, explicitly consented online resolution, and trap
      reception on port 1162 work in the retained Wayland Flatpak audit.
- [x] Local AppImage and Flatpak repository updates are tested between consecutive rc.1/rc.2 builds
      with installed artifact/commit equality.
- [ ] Signed NSIS and hosted GitHub-backed AppImage updates are tested between consecutive release
      candidates on their target/hosted environments.

## Mobile and publication

- [x] The current APK installs and passes the core journey on the local Android 16 emulator, including
      SNMP Get/Walk/cancel, consent-gated resolution, trap send/receive, and logcat checks; the AAB
      verifies structurally/signature-wise but real publication signing remains unchecked above.
- [x] The current APK passes a retained 130% text screenshot/UI-tree sweep without status-bar overlap,
      and active TalkBack performs visible next-item focus traversal while all five tab labels remain
      in the accessibility tree; independent human screen-reader observation is not claimed.
- [ ] The hosted macOS workflow produces an unsigned device IPA and archive inspection confirms the
      expected application payload; physical iOS installation is explicitly waived on this Linux host.
- [ ] Signing/notarization status and any unsigned-build warnings are documented.
- [ ] The GitHub prerelease is published automatically and contains every documented distributable plus `SHA256SUMS`.
- [ ] Temporary Actions artifacts use one-day retention.
- [ ] The workflow summary records the 500 MB soft-cap calculation and any deleted releases; Git tags remain intact.
- [x] The Flathub manifest uses immutable release sources and checksums before submission.
