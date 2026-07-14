#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
APK=${1:-}
SDK=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}
ADB=${ADB:-$SDK/platform-tools/adb}
ANDROID_JAR=$SDK/platforms/android-36/android.jar
UIAUTOMATOR_JAR=$SDK/platforms/android-36/uiautomator.jar
D8=$(find "$SDK/build-tools" -type f -name d8 | sort -V | tail -1)

if [[ -z "$APK" || ! -f "$APK" ]]; then
  echo "Usage: $0 path/to/release.apk" >&2
  exit 2
fi
for required in "$ADB" "$ANDROID_JAR" "$UIAUTOMATOR_JAR" "$D8"; do
  [[ -e "$required" ]] || { echo "Missing Android SDK component: $required" >&2; exit 2; }
done

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/stubsrc/junit/framework" "$TMP/stubclasses" "$TMP/classes" "$TMP/dex"
cat >"$TMP/stubsrc/junit/framework/TestCase.java" <<'JAVA'
package junit.framework;
public class TestCase {
  public static void assertTrue(String message, boolean value) {
    if (!value) throw new AssertionError(message);
  }
}
JAVA

javac -source 8 -target 8 -Xlint:-options \
  -d "$TMP/stubclasses" "$TMP/stubsrc/junit/framework/TestCase.java"
javac -source 8 -target 8 -Xlint:-options \
  -cp "$TMP/stubclasses:$ANDROID_JAR:$UIAUTOMATOR_JAR" \
  -d "$TMP/classes" "$ROOT/dev/audit/android-release-smoke/ReleaseSmokeTest.java"
"$D8" --lib "$ANDROID_JAR" --classpath "$UIAUTOMATOR_JAR" \
  --output "$TMP/dex" "$TMP/classes/dev/mibbeacon/ReleaseSmokeTest.class" >/dev/null
(cd "$TMP/dex" && zip -q -FS "$TMP/ReleaseSmokeTest.jar" classes.dex)

"$ADB" uninstall com.librestatic.mibbeacon >/dev/null 2>&1 || true
"$ADB" install "$APK" >/dev/null
"$ADB" push "$TMP/ReleaseSmokeTest.jar" /data/local/tmp/ReleaseSmokeTest.jar >/dev/null
"$ADB" logcat -c

run_test() {
  local method=$1
  local output
  "$ADB" shell cmd statusbar collapse
  "$ADB" shell pkill -f uiautomator >/dev/null 2>&1 || true
  sleep 1
  output=$("$ADB" shell uiautomator runtest ReleaseSmokeTest.jar \
    -c "dev.mibbeacon.ReleaseSmokeTest#$method" -e outputFormat simple)
  printf '%s\n' "$output"
  grep -Eq 'OK \([0-9]+ tests?\)' <<<"$output"
}

fixture_container=$(docker ps --format '{{.ID}} {{.Ports}}' | awk '/1611->161\/udp/ { print $1; exit }')
if [[ -z "$fixture_container" ]]; then
  echo "An SNMP fixture published on host UDP 1611 is required." >&2
  echo "Start it with: docker compose -f dev/snmpd/docker-compose.yml up -d --build" >&2
  exit 2
fi

udp_in() {
  docker exec "$fixture_container" awk '/^Udp: / { if (++n == 2) print $2 }' /proc/net/snmp
}

run_test testColdStartAndNavigation
run_test testSnmpGet
run_test testStreamingWalkAndCancellation
run_test testOnlineResolver
before=$(udp_in)
run_test testTrapSender
after=$(udp_in)
if (( after <= before )); then
  echo "Trap sender UI reported success but no datagram reached the fixture ($before -> $after)." >&2
  exit 1
fi

"$ADB" emu redir del udp:1162 >/dev/null 2>&1 || true
"$ADB" emu redir add udp:1162:1162 >/dev/null
"$ADB" shell cmd statusbar collapse
"$ADB" shell pkill -f uiautomator >/dev/null 2>&1 || true
sleep 1
"$ADB" shell uiautomator runtest ReleaseSmokeTest.jar \
  -c dev.mibbeacon.ReleaseSmokeTest#testTrapReceiver -e outputFormat simple \
  >"$TMP/receiver.log" 2>&1 &
receiver_pid=$!
sleep 25
node - <<'NODE'
const snmp = require('net-snmp');
const session = snmp.createSession('127.0.0.1', 'public', { trapPort: 1162 });
session.trap(snmp.TrapType.ColdStart, [], { upTime: 1 }, (error) => {
  if (error) { console.error(error); process.exitCode = 1; }
  setTimeout(() => session.close(), 100);
});
NODE
if ! wait "$receiver_pid"; then
  cat "$TMP/receiver.log" >&2
  exit 1
fi
cat "$TMP/receiver.log"
grep -Eq 'OK \([0-9]+ tests?\)' "$TMP/receiver.log"
"$ADB" emu redir del udp:1162 >/dev/null 2>&1 || true

if "$ADB" logcat -d | grep -Eq 'JavascriptException|FATAL EXCEPTION.*mibbeacon'; then
  echo "Release APK emitted a JavaScript or fatal runtime exception." >&2
  "$ADB" logcat -d | grep -E 'JavascriptException|FATAL EXCEPTION' >&2
  exit 1
fi

echo "Android release smoke passed: cold start/navigation, SNMP Get, 1,000+ row streamed walk/cancellation, consent-gated online resolution, trap sender, and trap receiver."
