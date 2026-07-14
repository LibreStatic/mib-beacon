#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
APK=${1:-}
SDK=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}
ADB=${ADB:-$SDK/platform-tools/adb}
OUT=${MIBBEACON_ANDROID_AX_OUT:-$ROOT/docs/audits/android-accessibility}
TALKBACK_PACKAGE=com.google.android.marvin.talkback
TALKBACK_SERVICE=$TALKBACK_PACKAGE/com.google.android.marvin.talkback.TalkBackService

if [[ -z "$APK" || ! -f "$APK" ]]; then
  echo "Usage: $0 path/to/release.apk" >&2
  exit 2
fi
[[ -x "$ADB" ]] || { echo "Missing adb: $ADB" >&2; exit 2; }
"$ADB" get-state >/dev/null
"$ADB" shell pm path "$TALKBACK_PACKAGE" >/dev/null || {
  echo "Android Accessibility Suite/TalkBack is not installed on the target." >&2
  exit 2
}

mkdir -p "$OUT"
old_font=$("$ADB" shell settings get system font_scale | tr -d '\r')
old_services=$("$ADB" shell settings get secure enabled_accessibility_services | tr -d '\r')
old_enabled=$("$ADB" shell settings get secure accessibility_enabled | tr -d '\r')

restore() {
  "$ADB" shell settings put system font_scale "$old_font" >/dev/null
  if [[ "$old_services" == "null" || -z "$old_services" ]]; then
    "$ADB" shell settings delete secure enabled_accessibility_services >/dev/null
  else
    "$ADB" shell settings put secure enabled_accessibility_services "$old_services" >/dev/null
  fi
  "$ADB" shell settings put secure accessibility_enabled "$old_enabled" >/dev/null
  "$ADB" shell am force-stop com.librestatic.mibbeacon >/dev/null
  "$ADB" shell am start -n com.librestatic.mibbeacon/.MainActivity >/dev/null
}
trap restore EXIT

assert_navigation_semantics() {
  local dump=$1
  for label in Browse Results Traps Tools Settings; do
    grep -q "content-desc=\"$label\"" "$dump" || {
      echo "Missing accessible navigation label at 130% scale: $label" >&2
      exit 1
    }
  done
}

"$ADB" install -r "$APK" >/dev/null
"$ADB" shell settings put system font_scale 1.3
"$ADB" shell am force-stop com.librestatic.mibbeacon
"$ADB" shell am start -n com.librestatic.mibbeacon/.MainActivity >/dev/null
sleep 4
"$ADB" shell uiautomator dump /sdcard/mibbeacon-font130.xml >/dev/null
"$ADB" pull /sdcard/mibbeacon-font130.xml "$OUT/font-scale-130.xml" >/dev/null
"$ADB" exec-out screencap -p >"$OUT/font-scale-130.png"
assert_navigation_semantics "$OUT/font-scale-130.xml"

# Avoid Android Accessibility Suite's own first-run notification prompt obscuring the app.
"$ADB" shell pm grant "$TALKBACK_PACKAGE" android.permission.POST_NOTIFICATIONS >/dev/null 2>&1 || true
if [[ "$old_services" == "null" || -z "$old_services" ]]; then
  enabled_services=$TALKBACK_SERVICE
elif [[ ":$old_services:" == *":$TALKBACK_SERVICE:"* ]]; then
  enabled_services=$old_services
else
  enabled_services=$old_services:$TALKBACK_SERVICE
fi
"$ADB" shell settings put secure enabled_accessibility_services "$enabled_services"
"$ADB" shell settings put secure accessibility_enabled 1
"$ADB" shell am force-stop com.librestatic.mibbeacon
"$ADB" shell am start -n com.librestatic.mibbeacon/.MainActivity >/dev/null
sleep 5
# A TalkBack next-item gesture must place the visible green accessibility focus ring on app content.
"$ADB" shell input swipe 250 1450 1050 1450 450
sleep 3
"$ADB" shell uiautomator dump /sdcard/mibbeacon-talkback.xml >/dev/null
"$ADB" pull /sdcard/mibbeacon-talkback.xml "$OUT/talkback.xml" >/dev/null
"$ADB" exec-out screencap -p >"$OUT/talkback.png"
"$ADB" shell dumpsys accessibility >"$OUT/talkback-dumpsys.txt"
grep -q "$TALKBACK_SERVICE" "$OUT/talkback-dumpsys.txt"
assert_navigation_semantics "$OUT/talkback.xml"

sha256sum \
  "$OUT/font-scale-130.xml" \
  "$OUT/font-scale-130.png" \
  "$OUT/talkback.xml" \
  "$OUT/talkback.png" \
  "$OUT/talkback-dumpsys.txt"
echo "Android accessibility smoke passed: 130% text semantics and active TalkBack focus traversal."
