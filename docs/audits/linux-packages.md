# Linux package smoke evidence

Audit date: 2026-07-13

The reproducible runner is `dev/audit/linux-package-smoke.sh`; run all headless checks with:

```bash
pnpm audit:linux-packages
```

From a Wayland desktop session, run the additional native display check with:

```bash
pnpm audit:linux-packages flatpak-wayland
```

An individual format can be selected with `deb`, `appimage`, `rpm`, `flatpak`, or
`flatpak-wayland`. The Wayland mode requires an active Wayland desktop session; the others are
headless. The runner
requires Docker, and the Flatpak check additionally requires a user Flatpak installation with the
Freedesktop 24.08 runtime already available. It refuses to replace an existing MIB Beacon Flatpak.

## Observed results

| Package | Clean environment | Evidence | Result |
| --- | --- | --- | --- |
| amd64 deb | Fresh Ubuntu 24.04 container | Local-package dependency resolution, package query, non-root Xvfb launch, `ENGINE_READY`, removal, binary absence | Pass |
| x86_64 AppImage | Fresh Ubuntu 24.04 container with `/dev/fuse` | Real FUSE mount observed while running, non-root Xvfb launch, `ENGINE_READY`, process/mount cleanup | Pass |
| x86_64 rpm | Fresh Fedora 42 container | DNF local install, RPM query, non-root Xvfb launch, `ENGINE_READY`, removal, binary absence | Pass |
| x86_64 Flatpak | Host user Flatpak plus isolated Ubuntu Xvfb display | Bundle install, sandboxed X11 launch, `ENGINE_READY`, process termination, uninstall, ref absence | Pass |
| x86_64 Flatpak | CachyOS Wayland session, X11 socket explicitly removed | Bundle install, automatic native Ozone/Wayland selection, `ENGINE_READY`, no X11 fallback, uninstall | Pass |

The deb test exposed a missing ALSA runtime dependency and then an incompatible compatibility
provider. The package now carries the complete electron-builder dependency set with
`libasound2t64 | libasound2`, and the rebuilt package passed the clean-container run. The AppImage
and native packages use `--no-sandbox` only because nested Docker cannot exercise Electron's normal
setuid sandbox; the Flatpak launch runs through its packaged sandbox.

`apps/desktop/release/SHA256SUMS` was regenerated after the package rebuilds and verified with
`sha256sum -c`; it covers both AppImages, both debs, both rpms, the Flatpak bundle, immutable Flatpak
sources, and release metadata.

## Evidence this does not claim

- These are clean userspace/container launch checks, not full Ubuntu/Fedora virtual-machine tests.
- The arm64 packages were built and checksummed but not executed on an arm64 host.
- Flatpak X11 and native Wayland launches passed. The separate
  `pnpm audit:flatpak-interactive` Wayland journey observed the native KDE portal OpenFile request,
  selected and imported `FIXTURE-MIB`, and proved imported-MIB plus theme/density persistence across
  a graceful restart. Evidence is retained in `flatpak-interactive.json` and
  `flatpak-interactive-settings.png`. That audit also uses Tab/Enter and documented shortcuts for
  import, explicitly opted-in missing-dependency resolution, search, a real Get, a 1,761-row Walk,
  Table View, trap receive, and settings, and retains direct Chromium accessibility-tree
  requirements for Browse, Query, and Traps. Every recorded keyboard-only leg passed.
- The same packaged run proved Secret Service-backed encrypted agent persistence, rendered a real
  `sysUpTime` chart (`flatpak-interactive-chart.png`), exercised its tooltip and valid themed PNG
  export (`flatpak-interactive-chart-export.png`), breached a watch, and captured its exact
  `org.freedesktop.Notifications.Notify` delivery call over D-Bus.
- Port-162 `setcap`, full SNMP/import journeys, and AppImage/Flatpak updates remain separate gates.
- Windows NSIS and macOS dmg install tests require their target operating systems.
