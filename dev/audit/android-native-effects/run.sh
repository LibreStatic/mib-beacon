#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
APK=${1:-}
SDK=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}
ADB=${ADB:-$SDK/platform-tools/adb}
OUT=${MIBBEACON_ANDROID_NATIVE_OUT:-$ROOT/docs/audits/android-native-effects}
APP=com.librestatic.mibbeacon
RECEIVER=com.librestatic.mibbeacon.auditreceiver
TITLE='MIB Beacon native adapter audit'
BODY='Release notification delivery verified.'
PNG_FILE='mib-beacon-native-adapter-audit.png'
PNG_BYTES=68
PNG_SHA256='431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460'
RECEIVER_LABEL='MIB Beacon audit receiver'

if [[ -z "$APK" || ! -f "$APK" ]]; then
  echo "Usage: $0 path/to/release.apk" >&2
  exit 2
fi
[[ -x "$ADB" ]] || { echo "Missing adb: $ADB" >&2; exit 2; }
"$ADB" get-state >/dev/null
mkdir -p "$OUT"

COMMIT=$(git -C "$ROOT" rev-parse HEAD)
EXPECTED=${MIB_BEACON_AUDIT_COMMIT:-${GITHUB_SHA:-}}
if [[ -n "$EXPECTED" ]]; then
  if [[ "$COMMIT" != "$EXPECTED" ]]; then
    echo "tested commit $COMMIT does not match expected $EXPECTED" >&2
    exit 1
  fi
  if [[ -n "$(git -C "$ROOT" status --porcelain=v1 --untracked-files=all)" ]]; then
    echo 'cannot attest MIB_BEACON_AUDIT_COMMIT from a dirty worktree' >&2
    exit 1
  fi
fi

RECEIVER_APK=$(find "$ROOT/apps/mobile/android/native-effects-audit-receiver/build/outputs/apk/release" -name '*.apk' -print -quit)
[[ -n "$RECEIVER_APK" ]] || { echo 'Native effects receiver APK is missing' >&2; exit 1; }

cleanup() {
  "$ADB" shell cmd statusbar collapse >/dev/null 2>&1 || true
  "$ADB" uninstall "$RECEIVER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# A clean install makes permission, initial-link, and chooser state deterministic.
"$ADB" uninstall "$APP" >/dev/null 2>&1 || true
"$ADB" uninstall "$RECEIVER" >/dev/null 2>&1 || true
"$ADB" install "$APK" >/dev/null
"$ADB" install "$RECEIVER_APK" >/dev/null
"$ADB" shell pm grant "$APP" android.permission.POST_NOTIFICATIONS
"$ADB" logcat -c

"$ADB" shell am start -W -a android.intent.action.VIEW -d 'mibbeacon://localhost/__native-audit/notification' "$APP" >/dev/null
for _ in $(seq 1 30); do
  "$ADB" shell dumpsys notification --noredact \
    | sed 's/[[:space:]]\+$//' >"$OUT/notification-dumpsys.txt"
  if python3 - "$OUT/notification-dumpsys.txt" "$APP" "$TITLE" "$BODY" <<'PY'
import re
import sys
from pathlib import Path

source, package, title, body = sys.argv[1:]
text = Path(source).read_text(encoding="utf-8", errors="replace")
records = re.split(r"(?=^    NotificationRecord\()", text, flags=re.MULTILINE)
for record in records:
    if (
        f"pkg={package} " in record
        and f"android.title=String ({title})" in record
        and f"android.text=String ({body})" in record
        and "mHidden==false" in record
        and "mIntercept=false" in record
    ):
        raise SystemExit(0)
raise SystemExit(1)
PY
  then
    notification_passed=true
    break
  fi
  sleep 1
done
[[ ${notification_passed:-false} == true ]] || {
  echo 'Expected visible notification record was not delivered.' >&2
  exit 1
}
"$ADB" shell cmd statusbar expand-notifications >/dev/null 2>&1 || true
sleep 1
"$ADB" exec-out screencap -p >"$OUT/notification-shade.png" || true
"$ADB" shell cmd statusbar collapse >/dev/null 2>&1 || true

"$ADB" shell am start -W -a android.intent.action.VIEW -d 'mibbeacon://localhost/__native-audit/share-png' "$APP" >/dev/null
for _ in $(seq 1 30); do
  "$ADB" shell uiautomator dump /sdcard/mibbeacon-native-audit-window.xml >/dev/null 2>&1 || true
  "$ADB" shell cat /sdcard/mibbeacon-native-audit-window.xml >"$OUT/share-chooser.xml" 2>/dev/null || true
  if gesture=$(node - "$OUT/share-chooser.xml" "$RECEIVER_LABEL" <<'JS'
const fs = require('node:fs');
const [source, label] = process.argv.slice(2);
const xml = fs.readFileSync(source, 'utf8');
const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const node = xml.match(new RegExp(`<node[^>]*(?:text|content-desc)="${escaped}"[^>]*>`))?.[0];
const bounds = node?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
if (bounds) {
  const [, left, top, right, bottom] = bounds.map(Number);
  process.stdout.write(`tap ${Math.floor((left + right) / 2)} ${Math.floor((top + bottom) / 2)}`);
  process.exit(0);
}
// The receiver can be below the initial app row. Scroll the semantic chooser
// container—not a guessed target coordinate—until its exact label is exposed.
const container = xml.match(/<node[^>]*resource-id="[^"]*chooser_scrollable_container"[^>]*>/)?.[0];
const containerBounds = container?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
if (!containerBounds) process.exit(1);
const [, left, top, right, bottom] = containerBounds.map(Number);
process.stdout.write(
  `swipe ${Math.floor((left + right) / 2)} ${bottom - 100} ${Math.floor((left + right) / 2)} ${top + 100}`,
);
JS
  ); then
    read -r action x1 y1 x2 y2 <<<"$gesture"
    if [[ "$action" == tap ]]; then
      "$ADB" shell input tap "$x1" "$y1"
    else
      "$ADB" shell input swipe "$x1" "$y1" "$x2" "$y2" 400
    fi
  fi
  sleep 1
  "$ADB" logcat -d -s MIBBeaconNativeAudit:I '*:S' >"$OUT/png-receiver-log.txt"
  grep -Fq 'PNG_RECEIVER_PASS' "$OUT/png-receiver-log.txt" && break
done
line=$(grep -F 'PNG_RECEIVER_PASS' "$OUT/png-receiver-log.txt" | tail -1)
grep -Fq 'action=ACTION_SEND' <<<"$line"
grep -Fq 'mime=image/png' <<<"$line"
grep -Fq "filename=$PNG_FILE" <<<"$line"
grep -Fq 'grant=read' <<<"$line"
grep -Fq "bytes=$PNG_BYTES" <<<"$line"
grep -Fq "sha256=$PNG_SHA256" <<<"$line"

APK_SHA=$(sha256sum "$APK" | cut -d' ' -f1)
RECEIVER_SHA=$(sha256sum "$RECEIVER_APK" | cut -d' ' -f1)
cat >"$OUT/evidence.json" <<EOF_JSON
{
  "schemaVersion": 1,
  "testedCommit": "$COMMIT",
  "releaseApkSha256": "$APK_SHA",
  "receiverApkSha256": "$RECEIVER_SHA",
  "notification": {
    "package": "$APP",
    "title": "$TITLE",
    "body": "$BODY",
    "authoritativeSource": "dumpsys notification --noredact",
    "delivered": true,
    "hidden": false,
    "intercepted": false
  },
  "pngShare": {
    "receiverPackage": "$RECEIVER",
    "action": "android.intent.action.SEND",
    "mimeType": "image/png",
    "fileName": "$PNG_FILE",
    "bytes": $PNG_BYTES,
    "sha256": "$PNG_SHA256",
    "readGrant": true,
    "pngSignature": true,
    "decodable": true
  }
}
EOF_JSON
(cd "$OUT" && sha256sum notification-dumpsys.txt png-receiver-log.txt share-chooser.xml evidence.json >SHA256SUMS)
if [[ -s "$OUT/notification-shade.png" ]]; then
  (cd "$OUT" && sha256sum notification-shade.png >>SHA256SUMS)
fi
echo "Android native effects passed for $COMMIT"
