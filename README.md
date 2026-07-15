# MIB Beacon

MIB Beacon is an experimental, open-source, cross-platform SNMP toolkit. It can
import and browse SMIv1/SMIv2 modules, query SNMP agents, send and receive traps, and
optionally resolve missing MIB dependencies from configured online sources.

Current version: **0.0.1-beta.1**. Treat every build as prerelease software.

> [!CAUTION]
> **AI-generated, unaudited software — use at your own risk.** This software has been
> created entirely through a mix of **Claude Fable 5**, **Claude Opus 4.8**, and
> **GPT 5.6 Sol**, used between medium and maximum reasoning levels. These AI models
> are the only sources of input on the code itself. No human work has been performed
> to ensure that the software is secure, correctly implemented, reliable, or fit for
> any particular purpose. This is a **quick-and-dirty hack job**, may contain serious
> defects or vulnerabilities, and should not be trusted in a corporate, production,
> safety-critical, or otherwise sensitive environment without an independent human
> security review, code audit, and thorough testing. Do not expose it directly to the
> public internet or use real credentials or sensitive network data unless you have
> independently accepted those risks.

## Quick links

- **Source repository:** <https://github.com/LibreStatic/mib-beacon>
- **Downloads and releases:** <https://github.com/LibreStatic/mib-beacon/releases>
- **Latest release:** <https://github.com/LibreStatic/mib-beacon/releases/latest>
- **Release checklist:** [`docs/RELEASE-CHECKLIST.md`](docs/RELEASE-CHECKLIST.md)
- **Setup and implementation documentation:** [`docs/plans/README.md`](docs/plans/README.md)
- **Runtime compatibility findings:** [`docs/plans/SPIKE-RESULTS.md`](docs/plans/SPIKE-RESULTS.md)
- **Packaging details:** [`docs/plans/10-packaging-release.md`](docs/plans/10-packaging-release.md)
- **License:** [`LICENSE`](LICENSE)

If the GitHub release page is empty or unavailable, no public binary has been
published yet. Build the application from source using the instructions below.

## Why MIB Beacon instead of iReasoning?

[iReasoning MIB Browser](https://www.ireasoning.com/mibbrowser.shtml) is an active,
capable product, but it is still a proprietary Java/Swing application: its free tier
is limited to personal use and 10 loaded MIB modules, while tools such as the trap
sender, graphs, and discovery sit in paid tiers. MIB Beacon is being built as the
maintained, genuinely free and open-source alternative: no license keys, no module
caps, native desktop packages, and a mobile experience for field work.

The rest of the field leaves the same opening. This is the competitive landscape
captured during the 2026 product-planning research:

| Tool                             | Status                        | Where it falls short                                                                                                              |
| -------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **iReasoning MIB Browser**       | Active, proprietary           | Java/Swing; free tier is personal-use only and capped at 10 MIBs; trap sender, graphs, and discovery require $495-$895/seat tiers |
| **SnmpB**                        | Abandoned (last release 2019) | Crash-prone, memory leaks, no packaging pipeline, and a dated Qt UI                                                               |
| **mbrowse / qtmib / Tkmib**      | Abandoned (2010-2014)         | GTK2/Qt4-era applications limited mostly to walk/get workflows                                                                    |
| **ManageEngine MibBrowser Free** | Freeware lead generation      | Unmaintained Java application, no trap sender, and not open source                                                                |
| **net-snmp CLI**                 | Active                        | The command-line workhorse, but it has no GUI, a strict parser, and cryptic errors                                                |
| **LibreNMS**                     | Active                        | A full NMS rather than an interactive MIB browser; no ad-hoc query UI                                                             |

The clearest opportunity is one none of those products covers: a maintained,
cross-platform FOSS GUI that can automatically resolve missing MIB dependencies from
online sources.

### Feature comparison with iReasoning

This matrix describes the intended v1 scope, not a promise that every row is complete
in the current beta. **✅** means v1 scope, **🔜** means designed now but planned for a
later release, and **➕** marks a MIB Beacon differentiator. See the
[product vision and feature matrix](docs/plans/00-product-vision.md) for the planning
source and accepted gaps.

| Category | Feature                                                                     | iReasoning            | MIB Beacon                                                                      |
| -------- | --------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------- |
| MIB      | SMIv1/v2 load and lenient parsing                                           | ✅ headline feature   | ✅ structured diagnostics showing what failed, where, and what was recovered ➕ |
| MIB      | Module cap                                                                  | 10 in free tier       | ✅ none                                                                         |
| MIB      | Persistent load list, module metadata, and unload                           | ✅                    | ✅                                                                              |
| MIB      | **Online dependency auto-resolution**                                       | ❌                    | ✅ ➕                                                                           |
| MIB      | **Custom MIB sources (FTP/HTTP/JSON catalog/GitHub)**                       | ❌                    | ✅ ➕                                                                           |
| Browse   | Tree with node-type icons and properties panel                              | ✅                    | ✅                                                                              |
| Browse   | Find in tree                                                                | ✅ by name            | ✅ fuzzy search across name, OID, and description ➕                            |
| Browse   | Unknown numeric OID to online lookup                                        | ❌                    | ✅ ➕                                                                           |
| Query    | Get/GetNext/GetBulk/Set/Walk/GetSubtree                                     | ✅                    | ✅                                                                              |
| Query    | SNMPv1/v2c/v3 with SHA-2 auth and AES-256 privacy                           | ✅                    | ✅; AES-192 is an accepted engine gap                                           |
| Query    | Per-agent credential memory and agent table                                 | ✅                    | ✅ encrypted at rest ➕                                                         |
| Query    | Address groups for multi-agent operations                                   | ✅                    | ✅                                                                              |
| Query    | Streaming results, cancellation, raw PDU view, and export                   | ✅                    | ✅                                                                              |
| Query    | Actionable SNMPv3 error messages                                            | ❌ generic errors     | ✅ ➕                                                                           |
| Table    | Index-decoded rows, polling, rotation, and CSV export                       | ✅                    | ✅                                                                              |
| Table    | Cell Set and RowStatus row creation/deletion                                | ✅                    | ✅                                                                              |
| Traps    | Receiver for v1/v2c/v3 and informs, with decode and detail views            | ✅ basic free support | ✅                                                                              |
| Traps    | Trap persistence and search                                                 | ✅ paid               | ✅                                                                              |
| Traps    | Sender for v1/v2c traps and informs, presets, and NOTIFICATION-TYPE prefill | ✅ $495 tier          | ✅                                                                              |
| Traps    | Rules/actions engine: filter to sound, command, email, or forward           | ✅ paid               | 🔜 post-v1                                                                      |
| Tools    | Performance graphs with rate/delta and export                               | ✅ paid               | ✅                                                                              |
| Tools    | Watches and polls                                                           | ✅ paid               | ✅; threshold actions 🔜                                                        |
| Tools    | Subnet discovery                                                            | ✅ paid               | ✅                                                                              |
| Tools    | Compare two devices side by side                                            | ✅ paid               | ✅                                                                              |
| Tools    | **Walk-file save/load and offline diff**                                    | Partial               | ✅ ➕                                                                           |
| Tools    | Port view for interface utilization and errors                              | ✅ paid               | ✅                                                                              |
| Tools    | Ping and traceroute                                                         | ✅ paid               | ✅ desktop; ping only on mobile                                                 |
| Tools    | Switch port mapper and Cisco snapshot                                       | ✅ paid               | 🔜 post-v1                                                                      |
| Platform | Windows, macOS, and Linux                                                   | ✅ Java               | ✅ native packages                                                              |
| Platform | **Android/iOS phone and tablet**                                            | ❌                    | ✅ ➕                                                                           |
| Platform | Dark mode, HiDPI, and responsive UI                                         | ❌                    | ✅ ➕                                                                           |
| Export   | Prometheus `snmp_exporter` and Zabbix configuration exports                 | ❌                    | 🔜 post-v1 ➕                                                                   |
| Misc     | Bookmarks combining agent, OID, and operation                               | ✅                    | ✅                                                                              |
| Misc     | Log window with decoded packet exchange                                     | ✅                    | ✅                                                                              |
| Misc     | CLI and scripting                                                           | ✅ bolted-on `.bat`   | 🔜 post-v1; the engine is already reusable                                      |

## Runtime kinds

MIB Beacon has three runtime kinds. They share the same application UI and engine API,
but place the UI and the SNMP-capable engine in different processes:

| Runtime kind | UI                                   | SNMP engine                     | Best for                                                          |
| ------------ | ------------------------------------ | ------------------------------- | ----------------------------------------------------------------- |
| **Desktop**  | Electron window on the same computer | Electron main process           | A single Linux, Windows, or macOS workstation                     |
| **Mobile**   | Native Android/iOS application       | In the mobile application       | Field work from a phone or tablet on the management network       |
| **Web LAN**  | Any modern browser on the LAN        | Node server on one trusted host | Shared browser access without installing a client on every device |

In **Web LAN** mode, browser requests travel over HTTP/WebSocket to the server and all
SNMP, trap, resolver, and tool traffic originates from the Docker/server host. Web LAN
mode has **no authentication** and is not an internet-facing or multi-tenant service.

## Choose a download

Each GitHub release is intended to include the following assets:

| Platform                        | Release asset    | Use it for                                                            |
| ------------------------------- | ---------------- | --------------------------------------------------------------------- |
| Linux                           | `.AppImage`      | Most glibc-based distributions; portable, no system install           |
| Debian/Ubuntu/Linux Mint        | `.deb`           | Native installation with `apt`                                        |
| Fedora/RHEL/Rocky/Alma/openSUSE | `.rpm`           | Native installation with `dnf`, `yum`, or `zypper`                    |
| Linux                           | `.flatpak`       | Sandboxed installation on distributions with Flatpak                  |
| Windows 10/11                   | `.exe`           | NSIS desktop installer                                                |
| macOS                           | `.dmg`           | Desktop application image                                             |
| Android                         | `.apk`           | Direct sideloading onto a device                                      |
| Android                         | `.aab`           | Store upload; **not directly installable** by end users               |
| iOS/iPadOS                      | `*-unsigned.ipa` | Advanced sideloading or re-signing only; not a normal App Store build |
| All                             | `SHA256SUMS`     | Checksums for verifying downloaded assets                             |

Release assets are named approximately
`MIB-Beacon-<version>-<platform>-<architecture>.<extension>`. Choose the architecture
that matches the device (`x86_64`/`x64` for most PCs, `arm64` for ARM devices).

### Verify a download

Download `SHA256SUMS` alongside the selected installer. On Linux, from the download
directory:

```bash
sha256sum -c SHA256SUMS --ignore-missing
```

On macOS, calculate a checksum and compare it with the matching line in
`SHA256SUMS`:

```bash
shasum -a 256 MIB-Beacon-*.dmg
```

On Windows PowerShell:

```powershell
Get-FileHash .\MIB-Beacon-*.exe -Algorithm SHA256
```

Checksums only detect a damaged or substituted download; they do not make this
unaudited software safe.

## Install a release

### Linux: AppImage (generic)

Use this on Ubuntu, Debian, Fedora, openSUSE, Arch, Manjaro, and most other
glibc-based desktop distributions:

```bash
chmod +x MIB-Beacon-*.AppImage
./MIB-Beacon-*.AppImage
```

The AppImage remains wherever it was downloaded or moved; deleting that file removes
the application. Some distributions require FUSE for AppImage support. Alpine Linux
uses musl rather than glibc and is not an official native target; use Flatpak where
available or build and test the software yourself.

> [!WARNING]
> On a default Ubuntu 24.04 installation, AppArmor may deny unprivileged user
> namespaces while the FUSE-mounted AppImage cannot use Electron's setuid sandbox.
> The generated AppImage launcher then falls back to Chromium's `--no-sandbox` mode.
> Prefer the Flatpak or a native deb/rpm package when process isolation matters, and
> do not use this AppImage for sensitive or corporate workloads without an independent
> security review. Do not weaken the host-wide AppArmor/user-namespace policy merely
> to suppress this warning.

### Debian, Ubuntu, Linux Mint, Pop!_OS, and derivatives

```bash
sudo apt install ./MIB-Beacon-*.deb
```

Uninstall with:

```bash
sudo apt remove mib-beacon
```

### Fedora

```bash
sudo dnf install ./MIB-Beacon-*.rpm
```

### RHEL, Rocky Linux, AlmaLinux, and compatible distributions

```bash
sudo dnf install ./MIB-Beacon-*.rpm
# On older releases: sudo yum install ./MIB-Beacon-*.rpm
```

### openSUSE

```bash
sudo zypper install ./MIB-Beacon-*.rpm
```

### Arch Linux and Manjaro

There is currently no official Arch package. Use the AppImage above, or install the
release Flatpak bundle:

```bash
flatpak install --user ./MIB-Beacon-*.flatpak
flatpak run com.librestatic.mibbeacon
```

The Flatpak bundle is not the same as a Flathub listing. Until the application is
published on Flathub, install the downloaded `.flatpak` file directly.

### Windows 10/11

1. Download the `.exe` installer from the release page.
2. Verify its SHA-256 checksum.
3. Run the installer and choose the installation directory when prompted.
4. Start **MIB Beacon** from the Start menu.

The tagged public-release workflow refuses to publish without a valid Windows signing
certificate and verifies the installed executable after installation. SmartScreen may
still warn while the certificate/application has little reputation. Do not bypass an
invalid-signature or unknown-publisher warning; verify the checksum and signature first.
Locally or unofficially built installers may be unsigned and are not equivalent to a
tagged project release. Uninstall from **Settings → Apps → Installed apps**.

### macOS

1. Download the `.dmg` matching the Mac architecture.
2. Verify its SHA-256 checksum.
3. Open the DMG and drag **MIB Beacon** into **Applications**.
4. Eject the DMG, then launch MIB Beacon from Applications.

The tagged public-release workflow refuses to publish without Developer ID signing and
successful notarization, and verifies Gatekeeper plus the stapled ticket before upload.
Do not bypass a signature, Gatekeeper, or notarization failure. Locally or unofficially
built DMGs may be unsigned/unnotarized and are not equivalent to a tagged project
release. Never disable Gatekeeper globally.

### Android

1. Download the `.apk` from the release page. Do not download the `.aab` for direct
   installation.
2. Verify the checksum on a trusted computer.
3. Allow installation from the specific browser or file-manager app when Android asks.
4. Open the APK and confirm installation.
5. Revoke the “install unknown apps” permission afterward.

The application requires native networking modules, so **Expo Go is not supported**.

### iOS and iPadOS

The release workflow produces an **unsigned device IPA**. It cannot be installed through
the App Store or by opening it normally. It must be re-signed or installed with a
compatible third-party sideloading tool and a valid Apple provisioning identity. The
exact process depends on that tool and Apple account and is intentionally not presented
as a supported one-click installation. Do not install it on a sensitive device.

## First-time setup

1. **Launch MIB Beacon.** Application state and imported modules are stored locally.
2. **Import a MIB.** Open **Browse**, choose **Import MIBs**, select a `.mib`, `.my`,
   `.smi`, or text MIB file, review the detected module and dependencies, then import it.
3. **Configure an SNMP target.** In the operation/query workspace, enter the device host,
   port, and SNMP version. For v1/v2c provide a community; for v3 provide the username,
   security level, and authentication/privacy settings required by the device.
4. **Test with a harmless read.** Query `1.3.6.1.2.1.1.1.0` (`sysDescr.0`) before trying
   walks, Sets, or trap operations.
5. **Enable online resolution only if wanted.** Open **Settings → Privacy & automation**,
   enable the resolver, and separately choose whether missing imports may be resolved
   automatically. External access is opt-in and may ask for consent.
6. **Configure traps.** Start with UDP port **1162**, which does not normally require
   administrator/root privileges. Point the sending device at the computer running MIB
   Beacon and allow that UDP port through the host firewall.

### Trap receiver ports on Linux

The standard SNMP trap port, UDP 162, is privileged on Linux. Port 1162 is the safest
default. A system-installed deb/rpm executable may be granted only the bind capability,
but this changes the security properties of the binary and must be repeated after an
upgrade:

```bash
sudo setcap 'cap_net_bind_service=+ep' '/opt/MIB Beacon/mib-beacon'
```

Do not apply this to an AppImage: capabilities do not survive its runtime mount. Prefer
port 1162 unless port 162 is strictly required. Windows and macOS users should also use
1162 rather than running the whole application as administrator/root.

## Files and directories

### Source tree

```text
apps/desktop       Electron desktop shell and desktop packaging configuration
apps/mobile        Expo/React Native Android and iOS application
apps/server        Optional LAN web server and headless SNMP engine
packages/app       Shared screens, navigation, and application state
packages/core      Sessions, operations, MIB store, trap store, and orchestration
packages/smi       SMIv1/SMIv2 parsing and diagnostics
packages/transport Platform-specific network, filesystem, crypto, and storage adapters
packages/resolver  Online and custom MIB resolution
packages/ui        Shared user-interface components
packaging/flatpak  Flatpak manifest and desktop metadata
dev/snmpd          Docker-based SNMP test agent
docs/plans         Architecture, implementation, runtime, and packaging documentation
tests              Repository-level verification tests
```

### Generated files

- Desktop build output: `apps/desktop/out/`
- Desktop installers/packages: `apps/desktop/release/`
- Android APK: `apps/mobile/android/app/build/outputs/apk/release/`
- Android AAB: `apps/mobile/android/app/build/outputs/bundle/release/`
- iOS build output: `apps/mobile/ios/build/`

These directories may not exist until their corresponding build has run.

### Application data

The desktop application stores `mibbeacon.db`, resolver data, encrypted resolver secrets,
and window state in Electron's per-user application-data directory. The usual locations
are under `~/.config/` on Linux, `%APPDATA%` on Windows, and
`~/Library/Application Support/` on macOS; the exact subdirectory can vary by package and
OS. Back up the complete MIB Beacon directory before modifying or removing it.

The optional source-run LAN server defaults to:

```text
~/.mibbeacon/server/
```

The Docker Compose Web LAN runtime instead stores the same data in the named volume
`mib-beacon_mibbeacon-server-data`.

Mobile data lives in the application sandbox managed by Android or iOS and is normally
removed when the application is uninstalled.

## Build and run from source

### Prerequisites

- Git
- Node.js **20 or newer** (Node 22+ recommended)
- pnpm **10.33.2** (the version pinned in `package.json`)
- A graphical desktop session for Electron
- Optional: Docker for the local SNMP test agent
- Android builds: Android Studio/SDK, Java, and an emulator or device
- iOS builds: macOS, Xcode, CocoaPods, and an Apple-compatible toolchain

Clone and install the workspace:

```bash
git clone https://github.com/LibreStatic/mib-beacon.git
cd mib-beacon
corepack enable
corepack prepare pnpm@10.33.2 --activate
pnpm install --frozen-lockfile
```

If the installed Node distribution does not include Corepack, install the pinned pnpm
version using the official pnpm installation method before running `pnpm install`.

### Desktop development

```bash
pnpm dev:desktop
```

Build distributables on the target operating system:

```bash
# Linux: AppImage, deb, and rpm
pnpm --filter @mibbeacon/desktop dist:linux

# Windows PowerShell: NSIS exe
pnpm --filter @mibbeacon/desktop dist:windows

# macOS: dmg
pnpm --filter @mibbeacon/desktop dist:mac
```

Cross-platform packaging is not guaranteed; build Windows packages on Windows and macOS
packages on macOS.

### Android development build

```bash
pnpm --filter @mibbeacon/mobile prebuild --platform android
pnpm dev:mobile
```

### iOS development build

Run this on macOS with Xcode installed:

```bash
pnpm --filter @mibbeacon/mobile prebuild --platform ios
pnpm --filter @mibbeacon/mobile ios
```

### Web LAN server

The LAN server runs the SNMP engine on one trusted host and serves the UI to browsers on
the same network. Docker Compose is the easiest way to bring up this runtime kind; it
builds the browser/server bundles, uses the Linux host network, and persists application
data in a named volume. Host networking lets the engine reach SNMP agents running on the
same computer: `127.0.0.1` refers to the Docker host rather than an isolated container,
and requests to the host's LAN address retain a source address accepted by LAN-only agent
ACLs.

`compose.yml` is the canonical definition. `docker-compose.yml` is a compatibility
symlink for tools that still require the legacy filename.

```bash
docker compose up --build -d
docker compose logs -f mibbeacon-server
```

When the health check reports `healthy`, open `http://<server-lan-ip>:8899` from another
device on the LAN. On Linux, `hostname -I` is a quick way to list candidate server
addresses. The Compose service uses `network_mode: host`, so TCP 8899 and any configured
trap receiver port (normally UDP 1162) bind directly on the Linux host. Those ports must
be free before startup.

Stop the runtime without deleting its data:

```bash
docker compose down
```

`docker compose down -v` also deletes the named data volume and is therefore destructive.
To change the HTTP/WebSocket port, set the server variable before starting it:

```bash
MIB_BEACON_SERVER_PORT=9000 docker compose up --build -d
# Open http://<server-lan-ip>:9000.
```

Choose the trap receiver port in MIB Beacon itself; host networking does not remap it.
Allow the selected ports through the host firewall, but do not forward them from the
router. An SNMP daemon must also authorize the queried address: host networking makes
`127.0.0.1` reachable, but it cannot override the daemon's own source-address ACL.

For source development without Docker:

```bash
pnpm dev:server
# Open http://<server-ip>:8899
```

Configuration variables:

| Variable                 | Default               | Purpose                             |
| ------------------------ | --------------------- | ----------------------------------- |
| `MIB_BEACON_SERVER_HOST` | `0.0.0.0`             | Address on which the server listens |
| `MIB_BEACON_SERVER_PORT` | `8899`                | HTTP/WebSocket port                 |
| `MIB_BEACON_SERVER_DATA` | `~/.mibbeacon/server` | Database/cache directory            |

**The LAN server has no authentication.** Run it only on a trusted, firewalled network;
never forward its ports from a router or expose them to the internet. Anyone who can
reach this runtime can drive SNMP operations from the server host.

## Validate a source checkout

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm verify:release-metadata
```

After building the complete local Linux and Android release inventory, inspect the
identity and hashes embedded in the artifacts themselves:

```bash
pnpm audit:artifact-identity
```

With KVM, QEMU, `qemu-img`, OpenSSH, and approximately 2 GB of temporary storage available,
the current x86_64 AppImage can also be exercised in a fresh official Ubuntu 24.04 VM. The
audit verifies the Ubuntu image's published checksum before booting it and records any sandbox
fallback honestly:

```bash
pnpm audit:ubuntu-vm-appimage
```

For a real local SNMP test agent:

```bash
docker compose -f dev/snmpd/docker-compose.yml up -d --build
pnpm spike:engine
```

## Security and operational notes

- Assume the code and binaries contain vulnerabilities until independently audited.
- Use a lab network and test credentials, not production SNMP communities or SNMPv3
  secrets.
- SNMPv1 and SNMPv2c community strings are not encryption. Prefer correctly configured
  SNMPv3 where possible.
- Online MIB resolution sends module names and requests to configured external sources;
  it is disabled until enabled by the user.
- Review imported vendor MIBs and their licenses before redistributing them.
- Prefer UDP 1162 for traps rather than elevated execution.
- The LAN server is unauthenticated and is suitable only for isolated testing.

## Documentation map

The current documentation is implementation-oriented:

- [`docs/plans/00-product-vision.md`](docs/plans/00-product-vision.md) — product scope and feature matrix
- [`docs/plans/01-architecture.md`](docs/plans/01-architecture.md) — architecture and security boundaries
- [`docs/plans/02-scaffolding-and-spike.md`](docs/plans/02-scaffolding-and-spike.md) — development environment and feasibility work
- [`docs/plans/03-mib-catalog-and-parser.md`](docs/plans/03-mib-catalog-and-parser.md) — MIB import and catalog behavior
- [`docs/plans/04-snmp-operations.md`](docs/plans/04-snmp-operations.md) — agent setup and SNMP operations
- [`docs/plans/05-trap-receiver-sender.md`](docs/plans/05-trap-receiver-sender.md) — trap configuration
- [`docs/plans/06-online-mib-resolution.md`](docs/plans/06-online-mib-resolution.md) — resolver behavior and privacy
- [`docs/plans/07-custom-sources.md`](docs/plans/07-custom-sources.md) — custom HTTP/FTP/JSON/GitHub sources
- [`docs/plans/10-packaging-release.md`](docs/plans/10-packaging-release.md) — packages, signing, updates, and releases
- [`docs/user/custom-sources.md`](docs/user/custom-sources.md) — HTTP, JSONPath, FTP/FTPS, and GitHub source examples
- [`docs/user/faq.md`](docs/user/faq.md) — DES, Expo Go, mobile traps, permissions, and privacy
- [`docs/user/updates-signing-and-stores.md`](docs/user/updates-signing-and-stores.md) — updater, OTA, credentials, and store policy
- [`docs/RELEASE-CHECKLIST.md`](docs/RELEASE-CHECKLIST.md) — release-candidate evidence matrix

Start with this README for installation and first-time setup, then use the linked plan
for the relevant subsystem. Some planned features or publication steps may still be
incomplete in the beta.

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) for the DCO sign-off, development gates,
workspace conventions, and definition of done. Any contribution should preserve the
local-first design, opt-in network access, actionable errors, and cancellable operations.
Report suspected vulnerabilities privately as described in [`SECURITY.md`](SECURITY.md).

## License

MIB Beacon is licensed under [GPL-3.0-or-later](LICENSE).
