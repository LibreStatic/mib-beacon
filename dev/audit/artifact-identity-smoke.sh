#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
RELEASE="$ROOT/apps/desktop/release"
APK="$ROOT/apps/mobile/android/app/build/outputs/apk/release/app-release.apk"
AAB="$ROOT/apps/mobile/android/app/build/outputs/bundle/release/app-release.aab"
REPORT=${1:-"$ROOT/docs/audits/artifact-identity.json"}
REPORT_LOG="${REPORT%.json}.log"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/mibbeacon-artifact-identity.XXXXXX")
ROWS="$WORK/evidence.tsv"
APP_ID=com.librestatic.mibbeacon
PRODUCT_NAME='MIB Beacon'
PUBLISHER=LibreStatic
VERSION=$(node -p "require('$ROOT/package.json').version")
DEB_VERSION=$(sed 's/-/~/' <<<"$VERSION")

cleanup() {
  rm -rf "$WORK"
}
trap cleanup EXIT

for command in 7z dpkg-deb file flatpak java javac node ostree pnpm python3 sed sha256sum unzip; do
  command -v "$command" >/dev/null || { echo "Missing required command: $command" >&2; exit 1; }
done
for path in "$RELEASE"/*.AppImage "$RELEASE"/*.deb "$RELEASE"/*.rpm \
  "$RELEASE"/*.flatpak "$RELEASE"/*-flatpak-source-*.tar.xz "$APK" "$AAB"; do
  [[ -f "$path" ]] || { echo "Missing expected artifact: $path" >&2; exit 1; }
done
: >"$ROWS"

record() {
  local path=$1 format=$2 arch=$3 package_id=$4 name=$5 version=$6 publisher=$7 assertion=$8
  local sha
  sha=$(sha256sum "$path" | cut -d' ' -f1)
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$(basename "$path")" "$format" "$arch" "$package_id" "$name" "$version" "$publisher" "$sha" "$assertion" >>"$ROWS"
}

inspect_asar() {
  local asar=$1 output=$2
  rm -f "$output"
  (
    cd "$(dirname "$output")"
    "$ROOT/node_modules/.bin/asar" extract-file "$asar" package.json
  )
  node - "$output" "$VERSION" "$APP_ID" "$PUBLISHER" <<'NODE'
const fs = require('node:fs');
const [path, version, appId, publisher] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(path, 'utf8'));
if (manifest.version !== version) throw new Error(`${path}: version mismatch`);
if (manifest.desktopName !== appId) throw new Error(`${path}: desktopName mismatch`);
if (manifest.author?.name !== publisher) throw new Error(`${path}: publisher mismatch`);
if (manifest.name !== '@mibbeacon/desktop') throw new Error(`${path}: package name mismatch`);
NODE
}

index=0
for image in "$RELEASE"/*.AppImage; do
  index=$((index + 1))
  dir="$WORK/appimage-$index"
  mkdir -p "$dir"
  7z x -y -o"$dir" "$image" "$APP_ID.desktop" resources/app.asar >/dev/null
  grep -Fxq "Name=$PRODUCT_NAME" "$dir/$APP_ID.desktop"
  grep -Fxq "StartupWMClass=$APP_ID" "$dir/$APP_ID.desktop"
  grep -Fxq "X-AppImage-Version=$VERSION" "$dir/$APP_ID.desktop"
  inspect_asar "$dir/resources/app.asar" "$dir/package.json"
  case "$(file -b "$image")" in
    *aarch64*) arch=arm64 ;;
    *x86-64*) arch=x86_64 ;;
    *) echo "Unknown AppImage architecture: $image" >&2; exit 1 ;;
  esac
  record "$image" AppImage "$arch" "$APP_ID" "$PRODUCT_NAME" "$VERSION" "$PUBLISHER" \
    'desktop entry and packaged app.asar identity match'
done

index=0
for package in "$RELEASE"/*.deb; do
  index=$((index + 1))
  dir="$WORK/deb-$index"
  mkdir -p "$dir"
  mapfile -t fields < <(dpkg-deb -f "$package" Package Version Architecture Maintainer Description | head -5)
  [[ "${fields[0]}" == 'Package: mib-beacon' ]]
  [[ "${fields[1]}" == "Version: $DEB_VERSION" ]]
  [[ "${fields[3]}" == "Maintainer: $PUBLISHER" ]]
  grep -Fq 'Cross-platform SNMP toolkit' <<<"${fields[4]}"
  dpkg-deb -x "$package" "$dir/root"
  desktop="$dir/root/usr/share/applications/$APP_ID.desktop"
  [[ -f "$desktop" ]]
  grep -Fxq "Name=$PRODUCT_NAME" "$desktop"
  inspect_asar "$dir/root/opt/MIB Beacon/resources/app.asar" "$dir/package.json"
  record "$package" deb "${fields[2]#Architecture: }" "$APP_ID" "$PRODUCT_NAME" "$DEB_VERSION" \
    "$PUBLISHER" 'control metadata, desktop entry, and packaged app.asar identity match'
done

python3 - "$ROWS" "$VERSION" "$APP_ID" "$PRODUCT_NAME" "$PUBLISHER" "$RELEASE" <<'PY'
import hashlib, struct, sys
from pathlib import Path

rows, version, app_id, product_name, publisher, release = sys.argv[1:]
tags_wanted = {1000, 1001, 1002, 1004, 1011, 1015, 1022, 1116, 1117, 1118}

def header(blob, position):
    if blob[position:position + 4] != bytes.fromhex('8eade801'):
        raise ValueError(f'invalid RPM header at {position}')
    _, count, size = struct.unpack_from('>III', blob, position + 4)
    indexes = [struct.unpack_from('>IIII', blob, position + 16 + i * 16) for i in range(count)]
    store = position + 16 + count * 16
    values = {}
    for tag, kind, offset, entries in indexes:
        if tag not in tags_wanted:
            continue
        data = blob[store + offset:store + size]
        if kind == 4:
            values[tag] = list(struct.unpack_from(f'>{entries}I', data))
        elif kind == 6:
            values[tag] = data.split(b'\0', 1)[0].decode()
        elif kind in (8, 9):
            values[tag] = [item.decode() for item in data.split(b'\0')[:entries]]
    return values, store + size

with open(rows, 'a', encoding='utf-8') as output:
    for path in sorted(Path(release).glob('*.rpm')):
        blob = path.read_bytes()
        _, end = header(blob, 96)
        values, _ = header(blob, (end + 7) & ~7)
        expected = {
            1000: 'mib-beacon', 1001: version.replace('-', '~'), 1002: '1',
            1004: 'Cross-platform SNMP toolkit', 1011: publisher, 1015: publisher,
        }
        for tag, value in expected.items():
            actual = values[tag][0] if isinstance(values[tag], list) else values[tag]
            if actual != value:
                raise ValueError(f'{path}: RPM tag {tag}: {actual!r} != {value!r}')
        basenames, dirindexes, dirnames = values[1117], values[1116], values[1118]
        paths = {dirnames[index] + name for name, index in zip(basenames, dirindexes)}
        if f'/usr/share/applications/{app_id}.desktop' not in paths:
            raise ValueError(f'{path}: canonical desktop entry missing')
        if '/opt/MIB Beacon/resources/app.asar' not in paths:
            raise ValueError(f'{path}: packaged app.asar missing')
        sha = hashlib.sha256(blob).hexdigest()
        fields = [path.name, 'rpm', values[1022], app_id, product_name,
                  f'{values[1001]}-{values[1002]}', publisher, sha,
                  'RPM header publisher and canonical payload paths match']
        output.write('\t'.join(fields) + '\n')
PY

flatpak_bundle=$(find "$RELEASE" -maxdepth 1 -type f -name '*.flatpak' -print -quit)
flatpak_dir="$WORK/flatpak"
mkdir -p "$flatpak_dir"
ostree init --repo="$flatpak_dir/repo" --mode=archive-z2
flatpak build-import-bundle "$flatpak_dir/repo" "$flatpak_bundle" >/dev/null
flatpak_ref=$(ostree refs --repo="$flatpak_dir/repo")
[[ "$flatpak_ref" == "app/$APP_ID/x86_64/master" ]]
ostree checkout --user-mode --repo="$flatpak_dir/repo" "$flatpak_ref" "$flatpak_dir/tree"
desktop="$flatpak_dir/tree/files/share/applications/$APP_ID.desktop"
metainfo="$flatpak_dir/tree/files/share/metainfo/$APP_ID.metainfo.xml"
grep -Fxq "Name=$PRODUCT_NAME" "$desktop"
grep -Fxq "X-Flatpak=$APP_ID" "$desktop"
grep -Fq "<id>$APP_ID</id>" "$metainfo"
grep -Fq "<developer id=\"com.librestatic\"><name>$PUBLISHER</name></developer>" "$metainfo"
inspect_asar "$flatpak_dir/tree/files/mib-beacon/resources/app.asar" "$flatpak_dir/package.json"
record "$flatpak_bundle" Flatpak x86_64 "$APP_ID" "$PRODUCT_NAME" "$VERSION" "$PUBLISHER" \
  'OSTree ref, desktop entry, metainfo, and packaged app.asar identity match'

index=0
for source in "$RELEASE"/*-flatpak-source-*.tar.xz; do
  index=$((index + 1))
  dir="$WORK/flatpak-source-$index"
  mkdir -p "$dir"
  tar -xJf "$source" -C "$dir" app/resources/app.asar
  inspect_asar "$dir/app/resources/app.asar" "$dir/package.json"
  case "$(basename "$source")" in
    *-aarch64.tar.xz) arch=aarch64 ;;
    *-x86_64.tar.xz) arch=x86_64 ;;
    *) echo "Unknown Flatpak source architecture: $source" >&2; exit 1 ;;
  esac
  record "$source" flatpak-source "$arch" "$APP_ID" "$PRODUCT_NAME" "$VERSION" "$PUBLISHER" \
    'immutable source packaged app.asar identity matches'
done

SDK=${ANDROID_HOME:-$HOME/Android/Sdk}
APKANALYZER="$SDK/cmdline-tools/latest/bin/apkanalyzer"
AAPT2=$(find "$SDK/build-tools" -mindepth 2 -maxdepth 2 -type f -name aapt2 | sort -V | tail -1)
[[ -x "$APKANALYZER" && -x "$AAPT2" ]]
APK_ID=$("$APKANALYZER" manifest application-id "$APK")
APK_VERSION=$("$APKANALYZER" manifest version-name "$APK")
APK_CODE=$("$APKANALYZER" manifest version-code "$APK")
[[ "$APK_ID" == "$APP_ID" && "$APK_VERSION" == "$VERSION" && "$APK_CODE" == 1 ]]
"$AAPT2" dump badging "$APK" >"$WORK/apk-badging.txt"
grep -Fq "application-label:'$PRODUCT_NAME'" "$WORK/apk-badging.txt"
record "$APK" APK multi "$APK_ID" "$PRODUCT_NAME" "$APK_VERSION" \
  'verification-only key; release publisher credential absent' \
  'compiled APK manifest identity matches; publication signer remains gated'

PROTO_JAR=$(find "$HOME/.gradle/caches/modules-2/files-2.1/com.android.tools.build/aapt2-proto" \
  -type f -name 'aapt2-proto-*.jar' | sort -V | tail -1)
PROTOBUF_JAR=$(find "$HOME/.gradle/caches/modules-2/files-2.1/com.google.protobuf/protobuf-java" \
  -type f -name 'protobuf-java-*.jar' | sort -V | tail -1)
[[ -f "$PROTO_JAR" && -f "$PROTOBUF_JAR" ]]
unzip -p "$AAB" base/manifest/AndroidManifest.xml >"$WORK/AabAndroidManifest.xml"
unzip -p "$AAB" base/resources.pb >"$WORK/resources.pb"
mkdir -p "$WORK/classes"
javac -cp "$PROTO_JAR:$PROTOBUF_JAR" -d "$WORK/classes" "$ROOT/dev/audit/AabManifestIdentity.java"
java -cp "$PROTO_JAR:$PROTOBUF_JAR:$WORK/classes" AabManifestIdentity \
  "$WORK/AabAndroidManifest.xml" "$WORK/resources.pb" >"$WORK/aab-identity.txt"
grep -Fxq "package=$APP_ID" "$WORK/aab-identity.txt"
grep -Fxq "versionName=$VERSION" "$WORK/aab-identity.txt"
grep -Fxq 'versionCode=1' "$WORK/aab-identity.txt"
grep -Fxq "applicationLabel=$PRODUCT_NAME" "$WORK/aab-identity.txt"
record "$AAB" AAB multi "$APP_ID" "$PRODUCT_NAME" "$VERSION" \
  'verification-only key; release publisher credential absent' \
  'protobuf base manifest identity matches; publication signer remains gated'

(cd "$RELEASE" && sha256sum --check --strict SHA256SUMS) >"$REPORT_LOG"
node - "$ROWS" "$REPORT" "$REPORT_LOG" "$APP_ID" "$PRODUCT_NAME" "$PUBLISHER" "$VERSION" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const [rowsPath, reportPath, checksumLog, applicationId, productName, publisher, version] =
  process.argv.slice(2);
const artifacts = fs
  .readFileSync(rowsPath, 'utf8')
  .trim()
  .split('\n')
  .map((line) => {
    const [artifact, format, architecture, packageId, name, version, publisher, sha256, assertion] =
      line.split('\t');
    return { artifact, format, architecture, packageId, name, version, publisher, sha256, assertion };
  });
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  canonicalIdentity: {
    applicationId,
    productName,
    publisher,
    version,
  },
  artifacts,
  checks: {
    desktopArtifactIdentity: 'passed',
    androidPackageIdentity: 'passed',
    desktopChecksumInventory: 'passed',
  },
  limitations: [
    'The Android APK/AAB use a deleted verification-only key, not the unavailable publication key.',
    'NSIS, dmg, and IPA identity still require their hosted target-platform artifacts.',
    'Uploaded-artifact identity and checksums remain unverified until a GitHub prerelease exists.',
  ],
  log: path.relative(path.dirname(reportPath), checksumLog),
  result: 'passed',
};
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
NODE

echo 'Local artifact identity audit passed.'
