#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
release_dir=${MIBBEACON_RELEASE_DIR:-"$root/apps/desktop/release"}
audit_dir=${MIBBEACON_AUDIT_DIR:-"$root/docs/audits"}
cache_dir=${MIBBEACON_VM_CACHE_DIR:-"${XDG_CACHE_HOME:-$HOME/.cache}/mibbeacon-vm-audit"}
image_url=${MIBBEACON_UBUNTU_IMAGE_URL:-https://cloud-images.ubuntu.com/releases/noble/release/ubuntu-24.04-server-cloudimg-amd64.img}
ssh_port=${MIBBEACON_VM_SSH_PORT:-22222}
seed_port=${MIBBEACON_VM_SEED_PORT:-18001}
qemu_img=${QEMU_IMG:-qemu-img}

log="$audit_dir/ubuntu-vm-appimage-smoke.log"
report="$audit_dir/ubuntu-vm-appimage-smoke.json"
mkdir -p "$audit_dir" "$cache_dir"

fail() {
  echo "ubuntu-vm-appimage-smoke: $*" >&2
  exit 1
}

for command in curl python3 qemu-system-x86_64 scp sha256sum ssh ssh-keygen; do
  command -v "$command" >/dev/null || fail "$command is required"
done
command -v "$qemu_img" >/dev/null || [[ -x "$qemu_img" ]] || fail "qemu-img is required (or set QEMU_IMG)"
[[ -c /dev/kvm ]] || fail '/dev/kvm is required for the clean-VM audit'

shopt -s nullglob
artifacts=("$release_dir"/MIB-Beacon-*-linux-x86_64.AppImage)
shopt -u nullglob
[[ ${#artifacts[@]} -eq 1 ]] || fail "expected exactly one x86_64 AppImage in $release_dir"
artifact=${artifacts[0]}
artifact_sha=$(sha256sum "$artifact" | awk '{print $1}')

image_name=${image_url##*/}
image="$cache_dir/$image_name"
checksums="$cache_dir/SHA256SUMS"
checksums_url=${image_url%/*}/SHA256SUMS
curl -fsSL --retry 3 -o "$checksums" "$checksums_url"
if [[ ! -f "$image" ]]; then
  partial="$image.partial"
  rm -f "$partial"
  curl -fL --retry 3 --progress-bar -o "$partial" "$image_url"
  mv "$partial" "$image"
fi
expected_image_sha=$(awk -v name="$image_name" '$2 == name || $2 == "*" name { print $1; exit }' "$checksums")
[[ -n "$expected_image_sha" ]] || fail "could not find $image_name in the official SHA256SUMS"
image_sha=$(sha256sum "$image" | awk '{print $1}')
[[ "$image_sha" == "$expected_image_sha" ]] || fail 'cached Ubuntu image checksum does not match the official release checksum'

work=$(mktemp -d "${TMPDIR:-/tmp}/mibbeacon-ubuntu-vm.XXXXXX")
guest="$work/guest.qcow2"
seed="$work/seed"
mkdir -p "$seed"
qemu_pid=''
seed_pid=''

cleanup() {
  set +e
  if [[ -n "$qemu_pid" ]] && kill -0 "$qemu_pid" 2>/dev/null; then
    kill "$qemu_pid" 2>/dev/null
    for _ in $(seq 1 20); do
      kill -0 "$qemu_pid" 2>/dev/null || break
      sleep 0.25
    done
    kill -KILL "$qemu_pid" 2>/dev/null || true
  fi
  [[ -n "$seed_pid" ]] && kill "$seed_pid" 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT

cp --reflink=auto "$image" "$guest"
"$qemu_img" resize "$guest" 8G >/dev/null
ssh-keygen -q -t ed25519 -N '' -f "$work/id_ed25519"
public_key=$(cat "$work/id_ed25519.pub")
cat >"$seed/meta-data" <<'EOF'
instance-id: mibbeacon-clean-ubuntu-vm
local-hostname: mibbeacon-clean
EOF
cat >"$seed/user-data" <<EOF
#cloud-config
users:
  - name: tester
    groups: [adm, sudo]
    shell: /bin/bash
    sudo: ALL=(ALL) NOPASSWD:ALL
    ssh_authorized_keys:
      - $public_key
ssh_pwauth: false
runcmd:
  - [ sh, -c, 'touch /var/tmp/mibbeacon-cloud-init-ready' ]
EOF
: >"$seed/vendor-data"

python3 -m http.server "$seed_port" --bind 0.0.0.0 --directory "$seed" >"$work/seed-server.log" 2>&1 &
seed_pid=$!
qemu-system-x86_64 \
  -enable-kvm -machine accel=kvm -cpu host -m 6144 -smp 4 \
  -drive "file=$guest,format=qcow2,if=virtio" \
  -netdev "user,id=net0,hostfwd=tcp:127.0.0.1:$ssh_port-:22" \
  -device virtio-net-pci,netdev=net0 \
  -smbios "type=1,serial=ds=nocloud-net;s=http://10.0.2.2:$seed_port/" \
  -display none -serial "file:$work/console.log" -no-reboot \
  -daemonize -pidfile "$work/qemu.pid"
qemu_pid=$(cat "$work/qemu.pid")

ssh_options=(
  -i "$work/id_ed25519"
  -p "$ssh_port"
  -o StrictHostKeyChecking=no
  -o UserKnownHostsFile=/dev/null
  -o ConnectTimeout=2
)
scp_options=(
  -i "$work/id_ed25519"
  -P "$ssh_port"
  -o StrictHostKeyChecking=no
  -o UserKnownHostsFile=/dev/null
  -o ConnectTimeout=2
)
ready=false
for _ in $(seq 1 240); do
  if ssh "${ssh_options[@]}" tester@127.0.0.1 \
    'test -f /var/tmp/mibbeacon-cloud-init-ready &&
     cloud-init status --wait >/dev/null 2>&1; status=$?;
     test "$status" -eq 0 || test "$status" -eq 2' \
    >/dev/null 2>&1; then
    ready=true
    break
  fi
  kill -0 "$qemu_pid" 2>/dev/null || fail 'QEMU exited before cloud-init completed'
  sleep 2
done
[[ "$ready" == true ]] || fail 'timed out waiting for the clean Ubuntu guest'

ssh "${ssh_options[@]}" tester@127.0.0.1 \
  'sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq &&
   sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
     ca-certificates dbus-x11 fuse3 libfuse2t64 libasound2t64 libatspi2.0-0 \
     libgtk-3-0 libnotify4 libnss3 libsecret-1-0 libuuid1 libxss1 libxtst6 \
     procps xdg-utils xvfb >/tmp/mibbeacon-dependencies.log 2>&1'
scp -q "${scp_options[@]}" "$artifact" tester@127.0.0.1:/home/tester/MIB-Beacon.AppImage

set +e
ssh "${ssh_options[@]}" tester@127.0.0.1 'bash -s' <<'GUEST' >"$log" 2>&1
set -euo pipefail
chmod +x "$HOME/MIB-Beacon.AppImage"
echo "OS=$(source /etc/os-release; printf '%s %s' "$NAME" "$VERSION")"
echo "KERNEL=$(uname -r)"
echo "ARCH=$(uname -m)"
echo "VIRTUALIZATION=$(systemd-detect-virt)"
echo "APPIMAGE_SHA256=$(sha256sum "$HOME/MIB-Beacon.AppImage" | awk '{print $1}')"
echo "FUSE_DEVICE=$(stat -c '%F %a %U:%G' /dev/fuse)"
if unshare -Ur true 2>/dev/null; then
  echo 'UNPRIVILEGED_USER_NAMESPACE=true'
else
  echo 'UNPRIVILEGED_USER_NAMESPACE=false'
fi
rm -f "$HOME/app.log" "$HOME/fuse-mount.log" "$HOME/process.log" "$HOME/xvfb.log"
Xvfb :99 -ac -screen 0 1280x800x24 >"$HOME/xvfb.log" 2>&1 & xvfb=$!
trap 'kill "$xvfb" 2>/dev/null || true' EXIT
sleep 1
set +e
dbus-run-session -- env DISPLAY=:99 ELECTRON_ENABLE_LOGGING=1 \
  "$HOME/MIB-Beacon.AppImage" --smoke-test >"$HOME/app.log" 2>&1 & launcher=$!
seen_mount=false
for _ in $(seq 1 800); do
  if grep -E ' /tmp/\.mount_[^ ]+ fuse\.' /proc/mounts >"$HOME/fuse-mount.log"; then
    seen_mount=true
  fi
  ps -eo pid,args | grep -E '/tmp/\.mount_[^ ]+/mib-beacon' | grep -v grep >>"$HOME/process.log" || true
  kill -0 "$launcher" 2>/dev/null || break
  sleep 0.01
done
wait "$launcher"; status=$?
set -e
sort -u "$HOME/process.log" -o "$HOME/process.log" 2>/dev/null || true
cat "$HOME/app.log"
echo "APP_EXIT_STATUS=$status"
echo "FUSE_MOUNT_OBSERVED=$seen_mount"
cat "$HOME/fuse-mount.log" 2>/dev/null || true
echo 'PROCESS_COMMANDS_BEGIN'
cat "$HOME/process.log" 2>/dev/null || true
echo 'PROCESS_COMMANDS_END'
if grep -q -- '--no-sandbox' "$HOME/process.log"; then
  echo 'APPIMAGE_NO_SANDBOX_FALLBACK=true'
else
  echo 'APPIMAGE_NO_SANDBOX_FALLBACK=false'
fi
grep -F ENGINE_READY "$HOME/app.log"
grep -F SMOKE_MAIN_WINDOW_READY "$HOME/app.log"
[[ $status -eq 0 ]]
[[ $seen_mount == true ]]
if grep -E ' /tmp/\.mount_[^ ]+ fuse\.' /proc/mounts; then
  echo 'FUSE_MOUNT_LEAK=true'
  exit 1
fi
echo 'FUSE_MOUNT_LEAK=false'
echo 'RESULT=passed'
GUEST
smoke_status=$?
set -e
cat "$log"
[[ $smoke_status -eq 0 ]] || fail "guest AppImage smoke failed with status $smoke_status"

guest_artifact_sha=$(awk -F= '$1 == "APPIMAGE_SHA256" { print $2; exit }' "$log")
[[ "$guest_artifact_sha" == "$artifact_sha" ]] || fail 'host and guest AppImage checksums differ'
os=$(sed -n 's/^OS=//p' "$log" | head -1)
kernel=$(sed -n 's/^KERNEL=//p' "$log" | head -1)
virtualization=$(sed -n 's/^VIRTUALIZATION=//p' "$log" | head -1)
userns=$(sed -n 's/^UNPRIVILEGED_USER_NAMESPACE=//p' "$log" | head -1)
no_sandbox=$(sed -n 's/^APPIMAGE_NO_SANDBOX_FALLBACK=//p' "$log" | head -1)
generated_at=$(date -u +'%Y-%m-%dT%H:%M:%SZ')

GENERATED_AT="$generated_at" IMAGE_URL="$image_url" IMAGE_SHA="$image_sha" \
  ARTIFACT="$(basename "$artifact")" ARTIFACT_SHA="$artifact_sha" OS_NAME="$os" \
  KERNEL="$kernel" VIRTUALIZATION="$virtualization" USERNS="$userns" \
  NO_SANDBOX="$no_sandbox" python3 - "$report" <<'PY'
import json
import os
import sys

report = {
    "schemaVersion": 1,
    "generatedAt": os.environ["GENERATED_AT"],
    "result": "passed",
    "guest": {
        "imageUrl": os.environ["IMAGE_URL"],
        "imageSha256": os.environ["IMAGE_SHA"],
        "os": os.environ["OS_NAME"],
        "kernel": os.environ["KERNEL"],
        "virtualization": os.environ["VIRTUALIZATION"],
    },
    "artifact": {
        "name": os.environ["ARTIFACT"],
        "sha256": os.environ["ARTIFACT_SHA"],
        "hostGuestHashMatch": True,
    },
    "checks": {
        "fuseMountObserved": True,
        "fuseMountReleased": True,
        "engineReady": True,
        "mainWindowReady": True,
        "exitStatus": 0,
        "unprivilegedUserNamespaceAvailable": os.environ["USERNS"] == "true",
        "appImageNoSandboxFallbackObserved": os.environ["NO_SANDBOX"] == "true",
    },
}
with open(sys.argv[1], "w", encoding="utf-8") as handle:
    json.dump(report, handle, indent=2)
    handle.write("\n")
PY

ssh "${ssh_options[@]}" tester@127.0.0.1 'sudo poweroff' >/dev/null 2>&1 || true
echo "ubuntu-vm-appimage-smoke: passed; report=$report"
