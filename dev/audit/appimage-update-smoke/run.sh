#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
DESKTOP="$ROOT/apps/desktop"
REPORT=${1:-"$ROOT/docs/audits/appimage-update-smoke.json"}
REPORT_LOG="${REPORT%.json}.log"
BASE_VERSION=${MIBBEACON_UPDATE_SMOKE_BASE_VERSION:-0.0.1}
RC1_VERSION="$BASE_VERSION-rc.1"
RC2_VERSION="$BASE_VERSION-rc.2"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/mibbeacon-appimage-update.XXXXXX")
SERVER_PID=''

cleanup() {
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

for command in node pnpm python3 sha256sum timeout; do
  command -v "$command" >/dev/null || { echo "Missing required command: $command" >&2; exit 1; }
done

PORT=$(python3 - <<'PY'
import socket
with socket.socket() as listener:
    listener.bind(('127.0.0.1', 0))
    print(listener.getsockname()[1])
PY
)
FEED_URL="http://127.0.0.1:$PORT"
mkdir -p "$WORK/rc1" "$WORK/rc2" "$WORK/feed" "$WORK/home/.config" "$(dirname "$REPORT")"

pnpm --filter @mibbeacon/desktop build

write_config() {
  local config=$1 version=$2 output=$3
  node - "$config" "$DESKTOP/package.json" "$version" "$output" "$FEED_URL" <<'NODE'
const fs = require('node:fs');
const [configPath, packagePath, version, output, url] = process.argv.slice(2);
fs.writeFileSync(
  configPath,
  `const base = require(${JSON.stringify(packagePath)}).build;\n` +
    `module.exports = {...base, directories: {...base.directories, output: ${JSON.stringify(output)}}, ` +
    `extraMetadata: {version: ${JSON.stringify(version)}}, ` +
    `publish: {provider: 'generic', url: ${JSON.stringify(url)}}};\n`,
);
NODE
}

write_config "$WORK/rc1.cjs" "$RC1_VERSION" "$WORK/rc1"
write_config "$WORK/rc2.cjs" "$RC2_VERSION" "$WORK/rc2"

(
  cd "$DESKTOP"
  CSC_IDENTITY_AUTO_DISCOVERY=false TMPDIR="${TMPDIR:-/tmp}" \
    pnpm exec electron-builder --linux AppImage --x64 --publish never --config "$WORK/rc1.cjs"
  CSC_IDENTITY_AUTO_DISCOVERY=false TMPDIR="${TMPDIR:-/tmp}" \
    pnpm exec electron-builder --linux AppImage --x64 --publish never --config "$WORK/rc2.cjs"
)

RC1_APP="$WORK/rc1/MIB-Beacon-$RC1_VERSION-linux-x86_64.AppImage"
RC2_APP="$WORK/rc2/MIB-Beacon-$RC2_VERSION-linux-x86_64.AppImage"
CHANNEL_FILE="$WORK/rc2/rc-linux.yml"
for file in "$RC1_APP" "$RC2_APP" "$CHANNEL_FILE"; do
  [[ -f "$file" ]] || { echo "Expected updater artifact is missing: $file" >&2; exit 1; }
done

RC1_SHA=$(sha256sum "$RC1_APP" | cut -d' ' -f1)
RC2_SHA=$(sha256sum "$RC2_APP" | cut -d' ' -f1)
cp "$RC2_APP" "$CHANNEL_FILE" "$WORK/feed/"
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$WORK/feed" >"$WORK/http.log" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 100); do
  if python3 - "$FEED_URL/rc-linux.yml" <<'PY' >/dev/null 2>&1
import sys
from urllib.request import urlopen
with urlopen(sys.argv[1], timeout=0.2) as response:
    assert response.status == 200
PY
  then
    break
  fi
  sleep 0.1
done
kill -0 "$SERVER_PID" 2>/dev/null || { cat "$WORK/http.log" >&2; exit 1; }

chmod +x "$RC1_APP"
LAUNCH=("$RC1_APP" --update-smoke-test)
if command -v xvfb-run >/dev/null; then
  LAUNCH=(xvfb-run --auto-servernum "${LAUNCH[@]}")
elif [[ -n "${WAYLAND_DISPLAY:-}" ]]; then
  LAUNCH+=(--ozone-platform=wayland)
elif [[ -z "${DISPLAY:-}" ]]; then
  echo 'No xvfb-run or active graphical session is available for the AppImage smoke.' >&2
  exit 1
fi

set +e
HOME="$WORK/home" XDG_CONFIG_HOME="$WORK/home/.config" APPIMAGE_SILENT_INSTALL=true \
  timeout 600s "${LAUNCH[@]}" >"$WORK/app.log" 2>&1
LAUNCH_STATUS=$?
set -e
if [[ "$LAUNCH_STATUS" -ne 0 && "$LAUNCH_STATUS" -ne 143 ]]; then
  cat "$WORK/app.log" >&2
  echo "rc.1 AppImage exited with status $LAUNCH_STATUS" >&2
  exit 1
fi

MARKER=''
for _ in $(seq 1 600); do
  MARKER=$(find "$WORK/home/.config" -type f -name update-smoke.json -print -quit 2>/dev/null || true)
  if [[ -n "$MARKER" ]]; then
    STATE=$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1])).state" "$MARKER")
    [[ "$STATE" == error ]] && { cat "$MARKER" >&2; cat "$WORK/app.log" >&2; exit 1; }
    [[ "$STATE" == complete ]] && break
  fi
  sleep 1
done
[[ -n "$MARKER" ]] || { cat "$WORK/app.log" >&2; echo 'Update marker was not created.' >&2; exit 1; }

UPDATED_APP="$WORK/rc1/MIB-Beacon-$RC2_VERSION-linux-x86_64.AppImage"
[[ -f "$UPDATED_APP" ]] || { cat "$WORK/app.log" >&2; echo 'Updated AppImage was not installed.' >&2; exit 1; }
UPDATED_SHA=$(sha256sum "$UPDATED_APP" | cut -d' ' -f1)
[[ "$UPDATED_SHA" == "$RC2_SHA" ]] || { echo 'Installed AppImage hash differs from the rc.2 feed.' >&2; exit 1; }

node - "$MARKER" "$RC1_VERSION" "$RC2_VERSION" <<'NODE'
const fs = require('node:fs');
const [markerPath, from, expected] = process.argv.slice(2);
const marker = JSON.parse(fs.readFileSync(markerPath));
if (marker.state !== 'complete' || marker.fromVersion !== from || marker.expectedVersion !== expected) {
  throw new Error(`Unexpected updater marker: ${JSON.stringify(marker)}`);
}
NODE

cp "$WORK/app.log" "$REPORT_LOG"
node - "$REPORT" "$MARKER" "$RC1_VERSION" "$RC2_VERSION" "$RC1_SHA" "$RC2_SHA" "$UPDATED_SHA" "$REPORT_LOG" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const [reportPath, markerPath, fromVersion, expectedVersion, rc1Sha256, rc2Sha256, installedSha256, logPath] = process.argv.slice(2);
const marker = JSON.parse(fs.readFileSync(markerPath));
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  platform: 'linux-x86_64-AppImage',
  transport: 'localhost-only generic updater feed',
  fromVersion,
  expectedVersion,
  rc1Sha256,
  rc2Sha256,
  installedSha256,
  marker,
  log: path.relative(path.dirname(reportPath), logPath),
  result: 'passed',
};
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
NODE

echo "AppImage updater smoke passed: $RC1_VERSION -> $RC2_VERSION"
