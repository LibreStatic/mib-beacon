#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
DESKTOP="$ROOT/apps/desktop"
PACKAGING="$ROOT/packaging/flatpak"
APP_ID=com.librestatic.mibbeacon
REPORT=${1:-"$ROOT/docs/audits/flatpak-update-smoke.json"}
REPORT_LOG="${REPORT%.json}.log"
BASE_VERSION=${MIBBEACON_UPDATE_SMOKE_BASE_VERSION:-0.0.1}
RC1_VERSION="$BASE_VERSION-rc.1"
RC2_VERSION="$BASE_VERSION-rc.2"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/mibbeacon-flatpak-update.XXXXXX")
REMOTE="mibbeacon-update-smoke-$$"
DATA_DIR="$HOME/.var/app/$APP_ID"
DATA_BACKUP=''
INSTALLED=false

cleanup() {
  if $INSTALLED; then
    flatpak uninstall --user --noninteractive --delete-data "$APP_ID" >/dev/null 2>&1 || true
  fi
  flatpak remote-delete --user --force "$REMOTE" >/dev/null 2>&1 || true
  rm -rf "$DATA_DIR"
  if [[ -n "$DATA_BACKUP" && -e "$DATA_BACKUP" ]]; then
    mkdir -p "$(dirname "$DATA_DIR")"
    mv "$DATA_BACKUP" "$DATA_DIR"
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

for command in flatpak flatpak-builder node ostree pnpm timeout; do
  command -v "$command" >/dev/null || { echo "Missing required command: $command" >&2; exit 1; }
done
if flatpak info --user "$APP_ID" >/dev/null 2>&1; then
  echo "Refusing to replace an existing user installation of $APP_ID" >&2
  exit 1
fi
if [[ -e "$DATA_DIR" ]]; then
  DATA_BACKUP="$WORK/pre-existing-app-data"
  mv "$DATA_DIR" "$DATA_BACKUP"
fi

mkdir -p "$WORK/rc1" "$WORK/rc2" "$WORK/package/staging/app" "$WORK/repo" "$(dirname "$REPORT")"
cp "$PACKAGING/com.librestatic.mibbeacon.yml" \
  "$PACKAGING/com.librestatic.mibbeacon.desktop" \
  "$PACKAGING/com.librestatic.mibbeacon.xml" \
  "$PACKAGING/com.librestatic.mibbeacon.metainfo.xml" \
  "$PACKAGING/com.librestatic.mibbeacon.svg" \
  "$WORK/package/"

pnpm --filter @mibbeacon/desktop build

write_config() {
  local config=$1 version=$2 output=$3
  node - "$config" "$DESKTOP/package.json" "$version" "$output" <<'NODE'
const fs = require('node:fs');
const [configPath, packagePath, version, output] = process.argv.slice(2);
fs.writeFileSync(
  configPath,
  `const base = require(${JSON.stringify(packagePath)}).build;\n` +
    `module.exports = {...base, directories: {...base.directories, output: ${JSON.stringify(output)}}, ` +
    `extraMetadata: {version: ${JSON.stringify(version)}}};\n`,
);
NODE
}

write_config "$WORK/rc1.cjs" "$RC1_VERSION" "$WORK/rc1"
write_config "$WORK/rc2.cjs" "$RC2_VERSION" "$WORK/rc2"
(
  cd "$DESKTOP"
  CSC_IDENTITY_AUTO_DISCOVERY=false TMPDIR="${TMPDIR:-/tmp}" \
    pnpm exec electron-builder --linux --x64 --dir --config "$WORK/rc1.cjs"
  CSC_IDENTITY_AUTO_DISCOVERY=false TMPDIR="${TMPDIR:-/tmp}" \
    pnpm exec electron-builder --linux --x64 --dir --config "$WORK/rc2.cjs"
)

build_commit() {
  local unpacked=$1
  rm -rf "$WORK/package/staging/app"
  mkdir -p "$WORK/package/staging/app"
  cp -a "$unpacked/." "$WORK/package/staging/app/"
  flatpak-builder --user --force-clean --state-dir="$WORK/state" --repo="$WORK/repo" \
    "$WORK/build" "$WORK/package/com.librestatic.mibbeacon.yml"
  flatpak build-update-repo "$WORK/repo" >/dev/null
  flatpak info --user --show-commit "$APP_ID" 2>/dev/null || true
}

build_commit "$WORK/rc1/linux-unpacked"
RC1_REPO_COMMIT=$(ostree --repo="$WORK/repo" rev-parse app/$APP_ID/x86_64/master)
flatpak remote-add --user --no-gpg-verify "$REMOTE" "$WORK/repo"
flatpak install --user --noninteractive --no-deps "$REMOTE" "$APP_ID"
INSTALLED=true
RC1_INSTALLED_COMMIT=$(flatpak info --user --show-commit "$APP_ID")
[[ "$RC1_INSTALLED_COMMIT" == "$RC1_REPO_COMMIT" ]] || { echo 'rc.1 Flatpak commit mismatch.' >&2; exit 1; }

launch_smoke() {
  local version=$1 log=$2
  local command=(flatpak run --user "$APP_ID" --smoke-test)
  if command -v xvfb-run >/dev/null; then
    command=(xvfb-run --auto-servernum "${command[@]}")
  elif [[ -n "${WAYLAND_DISPLAY:-}" ]]; then
    command+=(--ozone-platform=wayland)
  elif [[ -z "${DISPLAY:-}" ]]; then
    echo 'No xvfb-run or active graphical session is available for the Flatpak smoke.' >&2
    exit 1
  fi
  timeout 120s "${command[@]}" >"$log" 2>&1
  grep -q "ENGINE_READY.*version: '$version'" "$log"
  grep -q 'SMOKE_MAIN_WINDOW_READY' "$log"
}

launch_smoke "$RC1_VERSION" "$WORK/rc1.log"

build_commit "$WORK/rc2/linux-unpacked"
RC2_REPO_COMMIT=$(ostree --repo="$WORK/repo" rev-parse app/$APP_ID/x86_64/master)
[[ "$RC2_REPO_COMMIT" != "$RC1_REPO_COMMIT" ]] || { echo 'rc.2 did not create a new Flatpak commit.' >&2; exit 1; }
flatpak update --user --noninteractive --no-deps "$APP_ID"
RC2_INSTALLED_COMMIT=$(flatpak info --user --show-commit "$APP_ID")
[[ "$RC2_INSTALLED_COMMIT" == "$RC2_REPO_COMMIT" ]] || { echo 'rc.2 Flatpak commit mismatch.' >&2; exit 1; }
launch_smoke "$RC2_VERSION" "$WORK/rc2.log"

cat "$WORK/rc1.log" "$WORK/rc2.log" >"$REPORT_LOG"
node - "$REPORT" "$RC1_VERSION" "$RC2_VERSION" "$RC1_REPO_COMMIT" "$RC2_REPO_COMMIT" "$REPORT_LOG" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const [reportPath, fromVersion, expectedVersion, rc1Commit, rc2Commit, logPath] = process.argv.slice(2);
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  platform: 'linux-x86_64-Flatpak',
  transport: 'localhost filesystem OSTree remote',
  fromVersion,
  expectedVersion,
  rc1Commit,
  rc2Commit,
  installedCommit: rc2Commit,
  smokeMarkers: ['ENGINE_READY', 'SMOKE_MAIN_WINDOW_READY'],
  log: path.relative(path.dirname(reportPath), logPath),
  result: 'passed',
};
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
NODE

echo "Flatpak repository update smoke passed: $RC1_VERSION -> $RC2_VERSION"
