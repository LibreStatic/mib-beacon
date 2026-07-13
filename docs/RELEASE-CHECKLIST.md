# Release checklist

## Identity and compliance

- [ ] Every artifact identifies as `com.librestatic.mibbeacon` and names LibreStatic as publisher.
- [ ] `pnpm verify:release-metadata`, typecheck, lint, and the full test suite pass.
- [ ] GPL license and third-party notices are present; no vendor MIBs or secrets are bundled.
- [ ] SHA-256 checksums match every uploaded artifact.

## Desktop packages

- [ ] AppImage launches on a clean supported Linux system.
- [ ] deb and rpm install, launch, and uninstall cleanly.
- [ ] Flatpak launches under Wayland and X11, persists settings, and accesses user-selected files through portals.
- [ ] NSIS installs on Windows 10/11; dmg opens on supported macOS versions.
- [ ] `.mib`, `.my`, and `.smi` files enter the import-review flow.
- [ ] MIB import, Browse, SNMP query, online resolution, and trap reception on port 1162 work.
- [ ] AppImage/NSIS update and Flatpak repository update are tested between consecutive release candidates.

## Mobile and publication

- [ ] APK/AAB install and pass the core journey on Android.
- [ ] The iOS archive reaches a physical device or TestFlight and passes the same journey.
- [ ] Signing/notarization status and any unsigned-build warnings are documented.
- [ ] GitHub Release remains draft until manual validation is recorded.
- [ ] The Flathub manifest uses immutable release sources and checksums before submission.
