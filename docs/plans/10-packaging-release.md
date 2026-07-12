# 10 — Packaging, Release & Compliance

Status: not-started
Depends on: all feature phases (can be developed in parallel from plan 02 onward for the CI parts; finalize last)

## Objective

Installable, updatable releases for Linux (AppImage/deb/rpm/Flatpak via Flathub), Windows
(NSIS), macOS (dmg), and Android (APK direct + AAB for Play); iOS build validated; a
tagged-release GitHub Actions pipeline; GPL compliance in order. All artifacts use the
LibreStatic-owned identifier `com.librestatic.openmibcatalog`.

## Tasks

### T1 — Desktop packaging (electron-builder)
- Targets: Linux AppImage + deb + rpm (x64, arm64), Windows NSIS (x64), macOS dmg (universal or x64+arm64).
- App metadata: id `com.librestatic.openmibcatalog`, publisher LibreStatic, icons (from plan 09), file associations: register `.mib`/`.my`/`.smi` open-with (desktop) → import flow.
- Flatpak/Flathub: manifest, AppStream metadata, Wayland/X11 and network permissions, portal-based file access, Flathub validation and publication. Flatpak updates through Flathub rather than `electron-updater`.
- **Trap-port helper**: post-install docs + in-app guidance only (no setuid tricks): Linux packages ship a `README`/docs note with the exact `setcap 'cap_net_bind_service=+ep' <binary>` line (and the AppImage caveat: setcap doesn't survive AppImage mount — recommend the 1162 fallback or deb/rpm for port 162); Windows/macOS rely on the 1162 fallback by default.
- Signing: Windows (defer if no cert — document unsigned-build SmartScreen implications), macOS (Developer ID + notarization — gate on credentials being available; unsigned macOS builds documented as "right-click open"), Linux none.
- Auto-update: `electron-updater` against GitHub Releases (AppImage/NSIS/dmg supported paths); update check opt-out setting; deb/rpm rely on repo/manual (post-v1: apt/copr repos).

### T2 — Mobile packaging (EAS / Gradle)
- Android: EAS build profiles (`preview` = APK for sideload/GitHub Releases, `production` = AAB) or plain `gradlew` in CI (prefer EAS for signing management; document both). Permissions audit: INTERNET only (UDP/TCP need nothing more); no location/etc. — keep the manifest minimal.
- iOS: EAS build to validate the whole native stack compiles and runs on-device (the plan-02 native modules were Android-validated; **this is where iOS support is proven**). App Store submission is post-v1 (needs account/review-cycle time); v1 ships TestFlight-ready artifacts.
- OTA updates (expo-updates) for JS-only patches: configure but keep conservative (patch releases only, never native-module changes).

### T3 — Release pipeline (GitHub Actions)
- On tag `v*`: matrix build (ubuntu → Linux targets + Android, windows → NSIS, macos → dmg + iOS archive if credentials present), run full test suite first, attach artifacts + SHA256SUMS to a draft GitHub Release, generate changelog (conventional commits or curated `CHANGELOG.md` — pick and document).
- Version sync: single source of truth for version (root package.json) propagated to app.json/build.gradle/plist at build time (script).
- Smoke test in CI: launch Electron headless (xvfb) and assert main window + engine init log; Android build boots in emulator and renders the main screen (Maestro or a minimal detox flow — cheapest reliable option; if flaky, manual checklist documented instead).

### T4 — GPL & dependency compliance
- `LICENSE` (GPL-3.0) at root (done); SPDX headers or `license` field in every workspace package.json.
- In-app About screen: version, GPL notice, link to source repo ("source of this exact version" — link release tag), bundled-dependency license list (generate with `license-checker`-type tool at build time; fail the build on GPL-incompatible or unknown licenses — allowlist MIT/BSD/Apache-2.0/ISC/0BSD).
- Verify no vendor MIB files are bundled in artifacts (they're fetched/cached as user data only) — grep the artifact contents in CI.
- `CONTRIBUTING.md` (DCO or CLA decision — default DCO sign-off), `SECURITY.md` (private disclosure contact), issue templates.

### T5 — Docs for release
- User-facing: README quickstart (install per platform, first walk in 5 minutes, trap receiver setup incl. port 162 note, enabling online resolution), `docs/user/` for the sources-manager JSONPath/FTP examples (reuse plan 07's examples), FAQ (DES support status per plan 02 findings, Expo Go unsupported, mobile trap limits).
- `docs/plans/` updated: every doc's Status line final; Deviations sections honest.

## Acceptance criteria
1. Tagging `v0.1.0-rc1` produces: AppImage+deb+rpm, NSIS exe, dmg, APK (+AAB), checksums — attached to a draft release by CI, tests green in the same run.
2. AppImage runs on a clean Ubuntu LTS VM; deb installs and the setcap line from docs makes port-162 trap receive work. NSIS installs on Windows 10/11 VM. dmg opens on macOS (signed or documented-unsigned path).
3. APK sideloads onto a clean Android device; full core journey works. iOS build reaches a device (TestFlight or dev build) and passes the same journey — or a concrete blocker list is filed.
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
