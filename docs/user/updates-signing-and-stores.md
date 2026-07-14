# Updates, signing, and distribution

## Desktop updates

Packaged AppImage, NSIS, and dmg builds use `electron-updater` against GitHub
Releases. Automatic checks are off on a fresh install so no update request is
made without consent; enable them in **Settings → Updates**, or use **Check
now**. deb/rpm installations update by downloading a newer package manually.
Flatpak installations update through the configured Flatpak remote/Flathub.

The release checklist requires an installed rc1→rc2 update on Linux AppImage
and Windows before a stable release. Updater metadata and blockmaps are release
assets and are covered by `SHA256SUMS`. When a tagged version ends in `-rc.2`, the hosted release
workflow downloads the matching `-rc.1` AppImage and NSIS installer, runs their explicit
`--update-smoke-test` operator mode against the newly published rc2, and retains a marker proving
that the restarted application reports the rc2 version. This diagnostic never runs during normal
startup and does not weaken the default-off automatic-update preference.

## Android signing

EAS `preview` produces an internally distributed APK and `production` produces
an AAB using EAS-managed credentials. The GitHub Actions Gradle path requires:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_STORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

The workflow refuses to publish an Android release without them. Keep the same
key for every update. Losing it prevents compatible direct/Play upgrades.

## OTA policy

`expo-updates` is installed with `runtimeVersion.policy = appVersion`, preventing
an update built for a different native application version from loading. OTA is
disabled until LibreStatic links an EAS project and records its project ID and
update URL. After that, use OTA only for reviewed JS/assets in a patch release;
native-module, permission, engine, or schema changes require APK/AAB/IPA builds.

## Windows and Apple signing

Local developer builds may be unsigned. The tagged publication workflow is stricter: it refuses to
build the Windows or macOS release job unless the Authenticode certificate, Developer ID
certificate, and Apple notarization credentials are complete. It then verifies every NSIS
Authenticode signature and verifies the dmg application with `codesign`, Gatekeeper `spctl`, and
the notarization ticket through `stapler`. Unsigned local Windows builds trigger SmartScreen;
unsigned local macOS builds may require **Control-click → Open** and remain development artifacts,
not official releases.

The iOS IPA is intentionally different: it is an unsigned device build for third-party
sideloading/re-signing and is not an App Store or TestFlight artifact. The hosted job inspects its
bundle identifier, device platform, arm64 Mach-O executable, and absent signature before upload.

## Store scope

Flathub is the only v0.x desktop-store target. Play Store and App Store
submission, winget, Homebrew, apt repositories, COPR, Snap, and TestFlight are
post-v1 work.
