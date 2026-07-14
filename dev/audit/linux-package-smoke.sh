#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
artifacts=${MIBBEACON_RELEASE_DIR:-"$root/apps/desktop/release"}
artifacts=$(readlink -f "$artifacts")
requested=${1:-all}

fail() {
  echo "linux-package-smoke: $*" >&2
  exit 1
}

one_artifact() {
  local pattern=$1
  local matches=()
  shopt -s nullglob
  matches=("$artifacts"/$pattern)
  shopt -u nullglob
  [[ ${#matches[@]} -eq 1 ]] || fail "expected one $pattern artifact in $artifacts, found ${#matches[@]}"
  basename "${matches[0]}"
}

require_engine_ready() {
  local log=$1
  grep -F 'ENGINE_READY' "$log" >/dev/null || {
    cat "$log" >&2
    fail "packaged application did not report ENGINE_READY"
  }
}

run_deb() {
  local artifact
  artifact=$(one_artifact 'MIB-Beacon-*-linux-amd64.deb')
  docker run --rm --name mibbeacon-deb-smoke -v "$artifacts:/artifacts:ro" ubuntu:24.04 bash -lc "
    set -euo pipefail
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq dbus-x11 xvfb procps '/artifacts/$artifact' >/tmp/install.log 2>&1 || { tail -100 /tmp/install.log; exit 1; }
    dpkg-query -W mib-beacon
    test -x '/opt/MIB Beacon/mib-beacon'
    useradd -m tester
    Xvfb :99 -ac -screen 0 1280x800x24 >/tmp/xvfb.log 2>&1 & xvfb=\$!
    sleep 2
    set +e
    runuser -u tester -- timeout 20s dbus-run-session -- env DISPLAY=:99 ELECTRON_ENABLE_LOGGING=1 '/opt/MIB Beacon/mib-beacon' --no-sandbox >/tmp/app.log 2>&1
    status=\$?
    set -e
    kill \"\$xvfb\" 2>/dev/null || true
    cat /tmp/app.log
    [[ \"\$status\" == 0 || \"\$status\" == 124 ]]
    grep -F ENGINE_READY /tmp/app.log
    DEBIAN_FRONTEND=noninteractive apt-get remove -y -qq mib-beacon >/tmp/remove.log 2>&1
    test ! -e '/opt/MIB Beacon/mib-beacon'
    echo 'deb install-launch-uninstall passed'
  "
}

run_appimage() {
  local artifact
  artifact=$(one_artifact 'MIB-Beacon-*-linux-x86_64.AppImage')
  docker run --rm --name mibbeacon-appimage-smoke \
    --device /dev/fuse --cap-add SYS_ADMIN --security-opt apparmor=unconfined \
    -v "$artifacts:/artifacts:ro" ubuntu:24.04 bash -lc "
      set -euo pipefail
      apt-get update -qq
      DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ca-certificates dbus-x11 fuse3 libfuse2t64 libasound2t64 libatspi2.0-0 libgtk-3-0 libnotify4 libnss3 libsecret-1-0 libuuid1 libxss1 libxtst6 procps xdg-utils xvfb >/tmp/install.log 2>&1 || { tail -100 /tmp/install.log; exit 1; }
      useradd -m tester
      Xvfb :99 -ac -screen 0 1280x800x24 >/tmp/xvfb.log 2>&1 & xvfb=\$!
      sleep 2
      runuser -u tester -- dbus-run-session -- env DISPLAY=:99 ELECTRON_ENABLE_LOGGING=1 '/artifacts/$artifact' --no-sandbox >/tmp/app.log 2>&1 & launcher=\$!
      for _ in \$(seq 1 40); do
        grep -F ENGINE_READY /tmp/app.log >/dev/null 2>&1 && break
        kill -0 \"\$launcher\" 2>/dev/null || { cat /tmp/app.log; exit 1; }
        sleep 0.5
      done
      grep -F ENGINE_READY /tmp/app.log
      mountpoint=\$(awk '\$3 ~ /^fuse\./ && \$2 ~ /\\/tmp\\/\\.mount_/ { print \$2; exit }' /proc/mounts)
      [[ -n \"\$mountpoint\" ]] || { echo 'AppImage did not use a FUSE mount' >&2; exit 1; }
      kill \"\$launcher\" 2>/dev/null || true
      sleep 1
      pkill -TERM -u tester 2>/dev/null || true
      sleep 1
      if grep -F \"\$mountpoint\" /proc/mounts >/dev/null; then
        runuser -u tester -- fusermount3 -u \"\$mountpoint\" || umount \"\$mountpoint\"
      fi
      wait \"\$launcher\" 2>/dev/null || true
      kill \"\$xvfb\" 2>/dev/null || true
      cat /tmp/app.log
      if grep -F \"\$mountpoint\" /proc/mounts >/dev/null; then
        echo 'AppImage mount leaked after exit' >&2
        grep -F \"\$mountpoint\" /proc/mounts >&2
        exit 1
      fi
      echo 'AppImage FUSE launch passed'
    "
}

run_rpm() {
  local artifact
  artifact=$(one_artifact 'MIB-Beacon-*-linux-x86_64.rpm')
  docker run --rm --name mibbeacon-rpm-smoke -v "$artifacts:/artifacts:ro" fedora:42 bash -lc "
    set -euo pipefail
    dnf -y -q install '/artifacts/$artifact' xorg-x11-server-Xvfb dbus-x11 procps-ng >/tmp/install.log 2>&1 || { tail -100 /tmp/install.log; exit 1; }
    rpm -q mib-beacon
    test -x '/opt/MIB Beacon/mib-beacon'
    useradd -m tester
    Xvfb :99 -ac -screen 0 1280x800x24 >/tmp/xvfb.log 2>&1 & xvfb=\$!
    sleep 2
    set +e
    runuser -u tester -- timeout 20s dbus-run-session -- env DISPLAY=:99 ELECTRON_ENABLE_LOGGING=1 '/opt/MIB Beacon/mib-beacon' --no-sandbox >/tmp/app.log 2>&1
    status=\$?
    set -e
    kill \"\$xvfb\" 2>/dev/null || true
    cat /tmp/app.log
    [[ \"\$status\" == 0 || \"\$status\" == 124 ]]
    grep -F ENGINE_READY /tmp/app.log
    dnf -y -q remove mib-beacon >/tmp/remove.log 2>&1
    test ! -e '/opt/MIB Beacon/mib-beacon'
    echo 'rpm install-launch-uninstall passed'
  "
}

run_flatpak() {
  command -v flatpak >/dev/null || fail 'flatpak is required for the Flatpak smoke'
  local artifact container display=97 log
  artifact=$(one_artifact 'MIB-Beacon-*-linux-x86_64.flatpak')
  container="mibbeacon-flatpak-xvfb-$$"
  log=$(mktemp)
  flatpak_container=$container
  flatpak_display=$display
  flatpak_log=$log
  if flatpak info --user com.librestatic.mibbeacon >/dev/null 2>&1; then
    rm -f "$log"
    fail 'refusing to replace an existing user Flatpak installation of com.librestatic.mibbeacon'
  fi
  cleanup_flatpak() {
    flatpak kill com.librestatic.mibbeacon >/dev/null 2>&1 || true
    flatpak uninstall --user --noninteractive com.librestatic.mibbeacon >/dev/null 2>&1 || true
    docker rm -f "${flatpak_container:-}" >/dev/null 2>&1 || true
    docker run --rm -v /tmp/.X11-unix:/tmp/.X11-unix ubuntu:24.04 \
      rm -f "/tmp/.X11-unix/X${flatpak_display:-97}" >/dev/null 2>&1 || true
    rm -f "${flatpak_log:-}"
    return 0
  }
  trap cleanup_flatpak EXIT

  docker run -d --rm --name "$container" -v /tmp/.X11-unix:/tmp/.X11-unix ubuntu:24.04 bash -lc \
    "apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq xvfb >/dev/null && rm -f /tmp/.X11-unix/X$display && exec Xvfb :$display -ac -screen 0 1280x800x24" >/dev/null
  for _ in $(seq 1 90); do
    [[ -S "/tmp/.X11-unix/X$display" ]] && break
    docker inspect "$container" >/dev/null 2>&1 || fail 'Flatpak Xvfb container stopped before display startup'
    sleep 1
  done
  [[ -S "/tmp/.X11-unix/X$display" ]] || fail 'timed out waiting for Flatpak Xvfb display'

  flatpak install --user --noninteractive --no-deps --reinstall "$artifacts/$artifact"
  set +e
  timeout 20s env DISPLAY=":$display" ELECTRON_ENABLE_LOGGING=1 flatpak run --user \
    --nosocket=wayland --socket=x11 com.librestatic.mibbeacon --ozone-platform=x11 >"$log" 2>&1
  local status=$?
  set -e
  flatpak kill com.librestatic.mibbeacon >/dev/null 2>&1 || true
  sleep 2
  cat "$log"
  [[ $status -eq 0 || $status -eq 124 ]] || fail "Flatpak launch exited with status $status"
  require_engine_ready "$log"
  removed=false
  for _ in $(seq 1 10); do
    if flatpak uninstall --user --noninteractive com.librestatic.mibbeacon >/dev/null 2>&1; then
      removed=true
      break
    fi
    flatpak kill com.librestatic.mibbeacon >/dev/null 2>&1 || true
    sleep 1
  done
  [[ $removed == true ]] || fail 'Flatpak could not be uninstalled after the launch smoke'
  ! flatpak info --user com.librestatic.mibbeacon >/dev/null 2>&1 || fail 'Flatpak remained installed after uninstall'
  echo 'Flatpak install-launch-uninstall passed'
  trap - EXIT
  cleanup_flatpak
}

run_flatpak_wayland() {
  command -v flatpak >/dev/null || fail 'flatpak is required for the Flatpak smoke'
  [[ ${XDG_SESSION_TYPE:-} == wayland && -n ${WAYLAND_DISPLAY:-} ]] ||
    fail 'flatpak-wayland requires an active Wayland desktop session'
  local artifact log status removed
  artifact=$(one_artifact 'MIB-Beacon-*-linux-x86_64.flatpak')
  log=$(mktemp)
  flatpak_wayland_log=$log
  if flatpak info --user com.librestatic.mibbeacon >/dev/null 2>&1; then
    rm -f "$log"
    fail 'refusing to replace an existing user Flatpak installation of com.librestatic.mibbeacon'
  fi
  cleanup_flatpak_wayland() {
    flatpak kill com.librestatic.mibbeacon >/dev/null 2>&1 || true
    flatpak uninstall --user --noninteractive com.librestatic.mibbeacon >/dev/null 2>&1 || true
    rm -f "${flatpak_wayland_log:-}"
    return 0
  }
  trap cleanup_flatpak_wayland EXIT

  flatpak install --user --noninteractive --no-deps --reinstall "$artifacts/$artifact"
  set +e
  timeout 20s flatpak run --user --nosocket=x11 --socket=wayland \
    com.librestatic.mibbeacon >"$log" 2>&1
  status=$?
  set -e
  flatpak kill com.librestatic.mibbeacon >/dev/null 2>&1 || true
  sleep 2
  cat "$log"
  [[ $status -eq 0 || $status -eq 124 ]] || fail "Flatpak Wayland launch exited with status $status"
  require_engine_ready "$log"
  ! grep -F 'ozone_platform_x11' "$log" >/dev/null || fail 'Flatpak fell back to X11'

  removed=false
  for _ in $(seq 1 10); do
    if flatpak uninstall --user --noninteractive com.librestatic.mibbeacon >/dev/null 2>&1; then
      removed=true
      break
    fi
    flatpak kill com.librestatic.mibbeacon >/dev/null 2>&1 || true
    sleep 1
  done
  [[ $removed == true ]] || fail 'Flatpak could not be uninstalled after the Wayland smoke'
  echo 'Flatpak native Wayland launch passed'
  trap - EXIT
  cleanup_flatpak_wayland
}

case "$requested" in
  deb) run_deb ;;
  appimage) run_appimage ;;
  rpm) run_rpm ;;
  flatpak) run_flatpak ;;
  flatpak-wayland) run_flatpak_wayland ;;
  all)
    run_deb
    run_appimage
    run_rpm
    run_flatpak
    ;;
  *) fail 'usage: linux-package-smoke.sh [all|deb|appimage|rpm|flatpak|flatpak-wayland]' ;;
esac
