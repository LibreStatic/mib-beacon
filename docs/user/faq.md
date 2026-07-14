# Frequently asked questions

## Is MIB Beacon production-ready or security-audited?

No. It is a beta and carries the explicit AI-generated, quick-and-dirty warning
at the top of the README. Do not assume it is suitable for a corporate network.

## Why is online MIB resolution disabled?

The application does not contact resolver sources until you enable the resolver
and consent. Source hosts learn the requested module names and your network
address. Cached modules remain available offline.

## Does SNMPv3 DES work?

DES availability depends on the host crypto runtime and build. The application
probes and gates unsupported choices. Prefer AES-128 or AES-256; do not design a
new deployment around DES.

## Can I run the mobile build in Expo Go?

No. UDP, TCP, SQLite, secure storage, and native crypto require a development or
release build. Use `expo run:android`, an APK, or an AAB-derived install.

## Can Android or iOS receive traps in the background?

Do not rely on it. Mobile trap reception is foreground-only and the OS may
suspend networking. Use the desktop or LAN engine as the durable receiver.

## Why does the receiver prefer port 1162?

UDP 162 is privileged on common Unix systems. Port 1162 avoids running the app
as root. See the README for the Linux package `setcap` alternative and AppImage
caveat.

## Are vendor MIBs bundled?

No. Release scans reject `.mib`, `.my`, and `.smi` files. User imports and
resolver downloads are private user data, not release payloads.
