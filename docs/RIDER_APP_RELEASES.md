# PM Rider Android app: releases and in-app updates

The rider app ships two ways:

- **PWA**: `portal.parcelmoover.com/rider/`. It updates itself through its
  service worker on every server deploy, so no action is needed.
- **Android APK**: the same React code (`rider/`) wrapped by Capacitor. We
  don't use the Play Store. Signed APKs are published to **GitHub Releases**,
  and the app updates itself from there.

This document covers the APK.

## How a rider gets an update

1. The app checks `releases/latest/download/update.json` on every launch, and
   again when it comes back to the foreground if 6 hours have passed.
2. If a newer version exists, a popup shows the version change (`1.4.0 → 1.4.1`),
   the release date, the download size and the **What's new** list from
   `rider/CHANGELOG.md`.
3. **Update now** downloads the APK. The app checks its SHA-256 and confirms
   it's PM Rider, newer, and signed with the same key.
4. The first time only, Android asks the rider to allow "Install unknown apps"
   for PM Rider. The popup explains this and opens the right Settings screen.
5. Android shows **"Do you want to update this app?"**. Play Protect may ask
   to scan the app first; the rider taps **Scan app**, then **Install**.
6. The app restarts on the new version. **Login and data are kept**: Android
   updates in place because the package ID and signing key are the same.

Riders can also check manually: **Profile → Check for updates**.

**Later** hides the popup for 24 hours. A **required** release (see below)
has no Later button.

## Releasing a new version (the normal workflow)

> Releases happen **only** when you push a `rider-v*` tag. Merging to `main`
> never publishes an APK, even if `rider/` changed.

1. **Bump the version** in `rider/package.json`:
   ```bash
   cd rider && npm version 1.4.1 --no-git-tag-version
   ```
2. **Write the release notes** at the top of `rider/CHANGELOG.md`, under the
   intro section:
   ```md
   ## 1.4.1 — 2026-10-20
   - Scan multiple parcels in one go
   - Fixed login on slow networks
   ```
   Riders read these in the popup. Write short, plain sentences, with no
   ticket numbers or developer jargon.
3. **Check it locally** (optional, CI runs the same check):
   ```bash
   node scripts/release-manifest.mjs check rider-v1.4.1
   ```
4. **Merge to `main`**, then tag that commit and push the tag:
   ```bash
   git checkout main && git pull
   git tag rider-v1.4.1
   git push origin rider-v1.4.1
   ```
5. Watch **Actions → Rider APK release**. In about 5 minutes the release
   appears under **Releases** with `pm-rider-1.4.1.apk` and `update.json`.
   Riders see the popup on their next launch.

### What CI checks (and why a release can fail)

| Check | Fails when |
| --- | --- |
| Nothing changed | `rider/` is identical to the previous `rider-v*` tag |
| Tag vs version | `rider-v1.4.1` but package.json says something else |
| Changelog | No `## 1.4.1` section, or the section has no bullets |
| Signing key | `RIDER_KEYSTORE_*` secrets missing, or the APK isn't signed with the key riders have (`RIDER_SIGNING_CERT_SHA256`) |
| versionCode | APK versionCode doesn't match package.json |

## Version rules

- `versionName` and `versionCode` both come from `rider/package.json`.
  Never edit them in `build.gradle`.
- `versionCode = MAJOR×10000 + MINOR×100 + PATCH` (1.4.1 → 10401). Each part
  must be 0–99.
- Android only updates when versionCode goes **up**. Never reuse or lower a
  version.
- **Required update**: add `(required)` to the changelog heading, for example
  `## 1.5.0 — 2026-11-01 (required)`. Riders below that version get a popup
  with no "Later" button. Use it when the server stops supporting an older
  app (an API change).

## Web-only vs native changes

Every rider change ships as a full APK, including React-only changes.
Releasing is cheap (one tag), but riders have to tap through the install
each time. Batch small fixes into one release when you can.

## One-time setup (already done, for admins)

1. Create the signing key: `bash rider/scripts/create-release-keystore.sh`.
   The script prints the next steps.
2. **Back up the `.jks` file and its password offline.** If the key is lost,
   every rider must uninstall and reinstall, which also logs them out.
3. Add the repository secrets and variable:
   - secret `RIDER_KEYSTORE_BASE64`: `base64 -i pm-rider-release.jks`
   - secret `RIDER_KEYSTORE_PASSWORD`
   - variable `RIDER_SIGNING_CERT_SHA256`: printed by the script
   - optional variable `RIDER_API_URL` (defaults to `https://portal.parcelmoover.com/api`)

**Moving from the old builds.** APKs up to 1.3 were debug builds signed on
one developer's laptop. Riders on those builds must uninstall **once** and
install 1.4.0 from the Releases page. After that, every update comes through
the popup.

## Testing the updater locally (emulator)

```bash
cd rider
# 1. Build the "old" app, pointing at a local manifest
export VITE_API_URL=https://portal.parcelmoover.com/api
export VITE_RIDER_UPDATE_MANIFEST_URL=http://localhost:8765/update.json
npm run build && npx cap sync android && (cd android && ./gradlew assembleDebug)
adb install -r android/app/build/outputs/apk/debug/app-debug.apk

# 2. Build a "new" APK: bump package.json to 1.4.1 temporarily, rebuild,
#    copy app-debug.apk to ~/upd/pm-rider-1.4.1.apk, then revert package.json
# 3. Write ~/upd/update.json (same shape as src/lib/appUpdater.ts UpdateManifest;
#    get sha256 with: shasum -a 256 ~/upd/pm-rider-1.4.1.apk)
# 4. Serve it to the emulator
cd ~/upd && python3 -m http.server 8765 &
adb reverse tcp:8765 tcp:8765
```

Then launch the app. Plain `http://` manifests work only in **debug** builds;
release builds require `https://`.

## Key files

| File | What it does |
| --- | --- |
| `rider/src/lib/appUpdater.ts` | Manifest URL, types, throttle and snooze |
| `rider/src/context/UpdateContext.tsx` | Update flow (check → download → permission → install) |
| `rider/src/components/UpdateSheet.tsx` | The popup |
| `rider/android/.../AppUpdaterPlugin.java` | Native download, checks, permission, installer |
| `rider/android/app/build.gradle` | Version from package.json, release signing |
| `rider/scripts/release-manifest.mjs` | Writes `update.json` and the release notes |
| `.github/workflows/rider-release.yml` | Tag → signed APK → GitHub Release |
| `rider/CHANGELOG.md` | The "What's new" text riders see |

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| "App not installed" / "package conflicts" | The installed app has a different signing key (usually an old debug build). Uninstall once, then install from Releases. |
| No popup after a release | The release isn't marked **Latest**, or the rider is offline. Profile → Check for updates shows the error. |
| "This update is signed with a different key" | The CI secret was changed to a different key. Restore the original keystore; never replace it. |
| Popup appears again right after updating | The tag was pushed without bumping package.json. CI blocks this now. |
| Old UI right after updating from ≤ 1.3 | Old builds registered a service worker. 1.4.0+ removes it at startup, and the next launch is clean. |

## Android limitations

- The rider always confirms the install. Silent updates require Play or
  device management (MDM).
- Play Protect may show "App scan recommended" on each update. **Scan app →
  Install** is safe.
- Installing restarts the app. Riders shouldn't update in the middle of a
  delivery.
- Google is rolling out developer verification for sideloaded apps (some
  countries from 2026, wider rollout later). When it reaches Nepal, the
  package and signing key must be registered in the Android Developer
  Console. No Play listing is needed.
