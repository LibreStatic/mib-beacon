# 10 — Packaging, Release & Compliance

Status: implemented (automated packaging/compliance gates complete; publication, real signing credentials, and platform install/update evidence remain release-gated)
Depends on: all feature phases (can be developed in parallel from plan 02 onward for the CI parts; finalize last)

## Objective

Installable, updatable releases for Linux (AppImage/deb/rpm/Flatpak via Flathub), Windows
(NSIS), macOS (dmg), and Android (APK direct + AAB for Play); an unsigned iOS device
IPA for third-party sideloading/resigning; a
tagged-release GitHub Actions pipeline; GPL compliance in order. All artifacts use the
LibreStatic-owned identifier `com.librestatic.mibbeacon`.

## Tasks

### T1 — Desktop packaging (electron-builder)

- Targets: Linux AppImage + deb + rpm (x64, arm64), Windows NSIS (x64), macOS dmg (universal or x64+arm64).
- App metadata: id `com.librestatic.mibbeacon`, publisher LibreStatic, icons (from plan 09), file associations: register `.mib`/`.my`/`.smi` open-with (desktop) → import flow.
- Flatpak/Flathub: manifest, AppStream metadata, Wayland/X11 and network permissions, portal-based file access, Flathub validation and publication. Flatpak updates through Flathub rather than `electron-updater`.
- **Trap-port helper**: post-install docs + in-app guidance only (no setuid tricks): Linux packages ship a `README`/docs note with the exact `setcap 'cap_net_bind_service=+ep' <binary>` line (and the AppImage caveat: setcap doesn't survive AppImage mount — recommend the 1162 fallback or deb/rpm for port 162); Windows/macOS rely on the 1162 fallback by default.
- Signing: local Windows/macOS developer builds may remain unsigned with explicit warnings, but the
  tagged publication workflow requires Windows Authenticode plus Apple Developer ID/notarization
  credentials. It verifies Authenticode and verifies the mounted dmg application with `codesign`,
  Gatekeeper, and `stapler` before upload. Linux requires no code signing.
- Auto-update: `electron-updater` against GitHub Releases (AppImage/NSIS/dmg supported paths); update check opt-out setting; deb/rpm rely on repo/manual (post-v1: apt/copr repos).

### T2 — Mobile packaging (EAS / Gradle)

- Android: EAS build profiles (`preview` = APK for sideload/GitHub Releases, `production` = AAB) or plain `gradlew` in CI (prefer EAS for signing management; document both). Permissions audit: INTERNET only (UDP/TCP need nothing more); no location/etc. — keep the manifest minimal.
- iOS: build an unsigned device application in CI and wrap it as an IPA for tools that sideload or re-sign unsigned applications. This is not directly installable through normal iOS distribution. Signed/TestFlight publication remains post-v1 and requires Apple credentials.
- OTA updates (expo-updates) for JS-only patches: configure but keep conservative (patch releases only, never native-module changes).

### T3 — Release pipeline (GitHub Actions)

- On a version-matching tag `v*`: matrix build (ubuntu → Linux targets + Android, windows → NSIS, macos → dmg + unsigned IPA), run the full test suite first, attach distributables, update metadata, and `SHA256SUMS`, then automatically publish a prerelease when the version contains a prerelease suffix.
- Version sync: root `package.json` is the canonical version; workspace and Expo manifests mirror it, release-metadata tests enforce consistency, and the tag must equal `v<version>`.
- Smoke test in CI: launch Electron headless (xvfb) and assert main window + engine init log; Android build boots in emulator and renders the main screen (Maestro or a minimal detox flow — cheapest reliable option; if flaky, manual checklist documented instead).
- Storage housekeeping: temporary Actions artifacts expire after one day. Before publication, sum GitHub Release asset sizes through the paginated Releases API and apply a project-defined 500 MB soft cap. Delete oldest drafts/prereleases first, then oldest stable releases if necessary, without deleting tags. If the new release alone exceeds the cap, publish it with an explicit workflow warning after removing useful older candidates. GitHub Release assets do not have a cumulative platform storage quota; this is a conservative project policy, not GitHub billing enforcement.

### T4 — GPL & dependency compliance

- `LICENSE` (GPL-3.0) at root (done); SPDX headers or `license` field in every workspace package.json.
- In-app About screen: version, GPL notice, link to source repo ("source of this exact version" — link release tag), bundled-dependency license list (generate with `license-checker`-type tool at build time; fail the build on GPL-incompatible or unknown licenses — allowlist MIT/BSD/Apache-2.0/ISC/0BSD).
- Verify no vendor MIB files are bundled in artifacts (they're fetched/cached as user data only) — grep the artifact contents in CI.
- `CONTRIBUTING.md` (DCO or CLA decision — default DCO sign-off), `SECURITY.md` (private disclosure contact), issue templates.

### T5 — Docs for release

- User-facing: README quickstart (install per platform, first walk in 5 minutes, trap receiver setup incl. port 162 note, enabling online resolution), `docs/user/` for the sources-manager JSONPath/FTP examples (reuse plan 07's examples), FAQ (DES support status per plan 02 findings, Expo Go unsupported, mobile trap limits).
- `docs/plans/` updated: every doc's Status line final; Deviations sections honest.

## Acceptance criteria

1. Tagging `v0.0.1-beta.1` produces AppImage+deb+rpm, Flatpak, NSIS exe, dmg, APK+AAB, unsigned IPA, updater metadata, and checksums — attached to a published GitHub prerelease by CI, with tests green in the same run.
2. AppImage runs on a clean Ubuntu LTS VM; deb installs and the setcap line from docs makes port-162 trap receive work. NSIS installs on Windows 10/11 VM. dmg opens on macOS (signed or documented-unsigned path).
3. APK sideloads onto a clean Android device and the full core journey works. The unsigned IPA contains a device build and is documented as requiring third-party sideloading or re-signing; signed device/TestFlight validation remains post-v1.
4. electron-updater updates rc1→rc2 successfully on Linux AppImage and Windows.
5. About screen license inventory present; license-audit CI step passes; no MIB files found in artifacts.
6. A `v0.1.0` release published from the pipeline with curated release notes.

## Test strategy

- CI itself is the test for builds; VM/device matrix checklist (above) executed manually per release candidate and recorded in the release PR.
- Keep a `RELEASE-CHECKLIST.md` distilled from criteria 2–5.

## Out of scope

Store submissions other than Flathub (Play/App Store/winget/brew), Snap packaging, apt/copr
repositories, crash reporting/telemetry (none by design; revisit opt-in crash reports post-v1
with a privacy-respecting backend), and headless/server distribution of the engine.

## Deviations and remaining release evidence

- Automatic desktop update checks default off to preserve the no-unapproved-network-request
  policy. Users can check manually and may explicitly enable automatic checks.
- `expo-updates` is installed with app-version runtime compatibility but is disabled until a real
  EAS project ID and update URL are configured; native-module changes still require store/package
  releases.
- Android release signing has no debug fallback. Local build verification may use an explicitly
  temporary test key, while publishable CI builds require all four Android signing secrets.
- The locally rebuilt release APK was installed on the host's Pixel 9 Pro Android 16 emulator. The
  reproducible release smoke navigated all five tabs, completed a real SNMP Get against
  `10.0.2.2:1611`, exercised the disclosure-gated Android resolver against mibbrowser.online and
  validated IF-MIB before resetting the opt-in, proved trap-sender delivery via the fixture's kernel
  UDP counter, and proved receiver persistence by injecting a trap through emulator UDP redirection.
  It also found and fixed
  a React Native trap-send crash caused by node-net-snmp's unavailable `process.uptime()` fallback.
  This is strong emulator evidence, not a substitute for later physical-device foreground/background
  behavior checks.
- Physical iOS execution is explicitly waived for this Linux-host goal. The applicable iOS gate is
  a successful unsigned device IPA build in the later hosted macOS GitHub Actions run, plus archive
  inspection; installation or signing on a physical iOS device is not a blocker here.
- The hosted IPA job now inspects the archive before upload: it requires one `Payload/*.app`, the
  expected bundle identifier, `iphoneos`, a Mach-O arm64 executable, and no valid code signature,
  and records those facts in the Actions summary.
- The tagged workflow now refuses incomplete Windows/macOS credentials rather than silently
  publishing unsigned desktop artifacts. It verifies Authenticode, Developer ID/Gatekeeper, the
  stapled notarization ticket, and Android APK/AAB signatures before upload. Credentials and a live
  hosted run are still required evidence; local unsigned developer behavior remains documented.
- Packaged builds expose an operator-only `--update-smoke-test` path. It accepts only an rc1 build,
  requires the provider to offer the consecutive rc2, persists atomic checking/downloading/
  installing evidence, and lets the restarted rc2 mark completion. After publishing an `-rc.2`
  tag, the hosted Linux and Windows jobs exercise that path against the matching published rc1 and
  retain the marker. Unit coverage passes, but the acceptance item remains open until the first real
  rc1→rc2 hosted run succeeds.
- Local Linux evidence covers x86_64/arm64 AppImage and deb, x86_64 rpm, and an x86_64 Flatpak
  generated from immutable hashed sources. The reproducible package audit passed fresh Ubuntu 24.04
  deb and FUSE AppImage launches, Fedora 42 rpm install-launch-uninstall, and Flatpak X11
  install-launch-uninstall. After adding automatic Ozone platform selection, the rebuilt Flatpak
  also passed a Wayland-only launch with its X11 socket removed. The interactive Wayland audit
  then observed the real KDE file-chooser portal call, selected/imported `FIXTURE-MIB`, and proved
  both the imported module and theme/density preferences survive a graceful restart. A separate
  reproducible audit now boots an official-checksum Ubuntu 24.04.4 KVM guest and proves the current
  x86_64 AppImage's transferred hash, FUSE mount, main-window readiness, clean exit, and mount
  cleanup. It also records the generated launcher's `--no-sandbox` fallback under Ubuntu's default
  user-namespace restriction, which README warns about rather than concealing. This is not a
  substitute for arm64 execution. NSIS, dmg, hosted IPA, hosted updater rc1→rc2, and
  store/publication checks still require their target platforms or external accounts.
