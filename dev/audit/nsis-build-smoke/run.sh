#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
DESKTOP="$ROOT/apps/desktop"
REPORT=${1:-"$ROOT/docs/audits/nsis-build-smoke.json"}
REPORT_LOG="${REPORT%.json}.log"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/mibbeacon-nsis-build.XXXXXX")
WINE_BIN=${MIBBEACON_WINE_BIN:-wine}

cleanup() {
  rm -rf "$WORK"
}
trap cleanup EXIT

for command in node pnpm file objdump 7z sha256sum; do
  command -v "$command" >/dev/null || { echo "Missing required command: $command" >&2; exit 1; }
done
command -v "$WINE_BIN" >/dev/null || {
  echo "Wine is required for Electron Builder's Linux-to-NSIS cross-build." >&2
  echo 'Set MIBBEACON_WINE_BIN to a working Wine launcher when it is not on PATH.' >&2
  exit 1
}

mkdir -p "$WORK/bin" "$WORK/out" "$(dirname "$REPORT")"
WINE_BIN=$(command -v "$WINE_BIN")
cat >"$WORK/bin/wine" <<EOF
#!/bin/sh
exec "$WINE_BIN" "\$@"
EOF
chmod +x "$WORK/bin/wine"

"$WINE_BIN" cmd /c ver >"$WORK/wine-version.log" 2>&1
EMULATED_WINDOWS_VERSION=$(tr -d '\r' <"$WORK/wine-version.log" | sed -n '/Windows/p' | head -1)
WINE_VERSION=$("$WINE_BIN" --version)
[[ -n "$EMULATED_WINDOWS_VERSION" && -n "$WINE_VERSION" ]] || {
  cat "$WORK/wine-version.log" >&2
  exit 1
}

node - "$WORK/config.cjs" "$DESKTOP/package.json" "$WORK/out" <<'NODE'
const fs = require('node:fs');
const [configPath, packagePath, output] = process.argv.slice(2);
fs.writeFileSync(
  configPath,
  `const base = require(${JSON.stringify(packagePath)}).build;\n` +
    `module.exports = {...base, directories: {...base.directories, output: ${JSON.stringify(output)}}};\n`,
);
NODE

pnpm --filter @mibbeacon/desktop build
(
  cd "$DESKTOP"
  PATH="$WORK/bin:$PATH" CSC_IDENTITY_AUTO_DISCOVERY=false TMPDIR="${TMPDIR:-/tmp}" \
    pnpm exec electron-builder --win nsis --x64 --publish never --config "$WORK/config.cjs"
) >"$WORK/build.log" 2>&1

INSTALLER=$(find "$WORK/out" -maxdepth 1 -type f -name 'MIB-Beacon-*-win-x64.exe' -print -quit)
[[ -n "$INSTALLER" && -f "$INSTALLER" ]] || { cat "$WORK/build.log" >&2; exit 1; }
[[ -f "$INSTALLER.blockmap" && -f "$WORK/out/latest.yml" ]] || {
  echo 'NSIS updater metadata is incomplete.' >&2
  exit 1
}
[[ -f "$WORK/out/win-unpacked/mib-beacon.exe" ]] || {
  echo 'The packaged x64 application executable is missing.' >&2
  exit 1
}

INSTALLER_FILE=$(file -b "$INSTALLER")
APP_FILE=$(file -b "$WORK/out/win-unpacked/mib-beacon.exe")
grep -q 'Nullsoft Installer' <<<"$INSTALLER_FILE"
grep -q 'PE32+.*x86-64' <<<"$APP_FILE"
7z l "$INSTALLER" >"$WORK/archive.log"
grep -Fq '$PLUGINSDIR/app-64.7z' "$WORK/archive.log"

objdump -x "$INSTALLER" >"$WORK/objdump.log"
grep -Eq '^Entry 4 0+ 0+ Security Directory$' "$WORK/objdump.log"
INSTALLER_SHA=$(sha256sum "$INSTALLER" | cut -d' ' -f1)
INSTALLER_SIZE=$(stat -c '%s' "$INSTALLER")
node "$ROOT/dev/scan-release-artifacts.mjs" "$WORK/out/win-unpacked" >"$WORK/scan.log"

cat "$WORK/wine-version.log" "$WORK/build.log" "$WORK/archive.log" "$WORK/objdump.log" \
  "$WORK/scan.log" >"$REPORT_LOG"
node - "$REPORT" "$WINE_VERSION" "$EMULATED_WINDOWS_VERSION" "$(basename "$INSTALLER")" "$INSTALLER_SHA" \
  "$INSTALLER_SIZE" "$INSTALLER_FILE" "$APP_FILE" "$REPORT_LOG" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const [
  reportPath,
  wineVersion,
  emulatedWindowsVersion,
  artifact,
  sha256,
  size,
  installerFile,
  appFile,
  logPath,
] = process.argv.slice(2);
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  buildHost: 'linux-x86_64',
  target: 'windows-x86_64-NSIS',
  compatibilityLayer: wineVersion,
  emulatedWindowsVersion,
  artifact,
  sha256,
  size: Number(size),
  installerFile,
  appFile,
  checks: {
    electronBuilderCompleted: true,
    updaterMetadataPresent: true,
    embeddedApplicationArchivePresent: true,
    unpackedPayloadScanPassed: true,
    authenticodeSecurityDirectory: 'absent (expected for local unsigned build)',
  },
  limitations: [
    'Cross-build evidence is not a Windows 10/11 installation or runtime test.',
    'The artifact is intentionally unsigned and is not publication-ready.',
  ],
  log: path.relative(path.dirname(reportPath), logPath),
  result: 'passed',
};
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
NODE

echo 'Unsigned NSIS cross-build and structural smoke passed.'
