# CLAUDE.md

## Design Context

`client/` (the ops dashboard) has `PRODUCT.md` and `DESIGN.md` at its root, written by `/impeccable init`. Read them before any UI work in `client/`.

- **Register:** product — this is an operations tool, not a marketing surface.
- **Platform:** web.
- **North Star:** "The Control Tower" — a calm, high-signal command center for watching parcels, money, and people move through pickup → dispatch → delivery → settlement.
- **Users:** two co-equal audiences share the app — internal ops staff (dispatch, admin, finance, CX, KYC) and vendor/merchant self-service users.
- **Key visual rules:** rust (`#c2410c`) is the only warm accent color in the system; same-plane surfaces (tables, cards, panels) separate with a 1px border, not a shadow; body/UI text defaults to medium weight (500) at 14px, not regular.

Full detail, anti-references, and the complete Do's/Don'ts list live in `client/PRODUCT.md` and `client/DESIGN.md`.

## Vendor API parity

For every vendor-facing capability or behavior change in `client/` or `/api`, update the matching Partner API (`/api/v1`) in the same work. Reuse the dashboard service and vendor ownership rules. Keep API-key authentication, idempotency for writes, rate limits, request validation, and structured errors consistent with neighboring Partner API endpoints. Update `server/src/lib/openapi.ts`, `docs/PARTNER_API.md`, and the interactive console in `server/docs-static/partner-api.html`; regenerate the served reference with `npm run docs:build` in `server/`. Add focused checks for the route and its vendor scope. If an action must remain staff-only, document that boundary explicitly.

## Rider Android APK releases

The rider app (`rider/`) ships as a PWA and as a Capacitor Android APK. The APK updates itself from GitHub Releases through an in-app popup. Full guide: `docs/RIDER_APP_RELEASES.md`.

Rules:

- **Never create, replace, or regenerate the release signing key** (`RIDER_KEYSTORE_*` secrets, `pm-rider-release.jks`). A different key makes Android reject updates, and every rider has to uninstall and log in again. Never commit `*.jks`, `*.keystore`, or `rider/android/keystore.properties`.
- **The version lives only in `rider/package.json`.** Gradle derives `versionName` and `versionCode` (`MAJOR*10000 + MINOR*100 + PATCH`, each part 0-99). Never hand-edit `versionCode`/`versionName` in `rider/android/app/build.gradle`. Versions must only increase.
- **Every rider-visible release needs a `rider/CHANGELOG.md` section** (`## X.Y.Z — YYYY-MM-DD`, then `- ` bullets) that matches the package.json version. Those bullets are shown to riders verbatim in the update popup, so write them as short, plain, rider-facing sentences with no ticket numbers or jargon. Add `(required)` to the heading only when older app versions can no longer work (for example, a breaking API change); it removes the "Later" button.
- **Releases are made only by pushing a `rider-v<version>` tag** (`.github/workflows/rider-release.yml`). Pushing to `main` never publishes an APK. Agents must not push release tags or create GitHub Releases unless the user explicitly asks.
- **`rider/android/` is committed.** Keep native changes there. Generated paths (`app/src/main/assets/public`, `capacitor-cordova-android-plugins`, build outputs) stay gitignored; run `npx cap sync android` after `npm run build` instead of committing them.
- **Don't let the PWA service worker run inside the APK.** `rider/src/main.tsx` registers it only in the browser and removes it on native, because it would otherwise serve the previous bundle after an update. Keep `injectRegister: null` in `rider/vite.config.ts`.
- **Updater code:** `rider/src/lib/appUpdater.ts` (manifest shape and URL), `rider/src/context/UpdateContext.tsx` (flow), `rider/src/components/UpdateSheet.tsx` (popup), `rider/android/app/src/main/java/com/parcelmoover/rider/AppUpdaterPlugin.java` (download, verification, install), `rider/scripts/release-manifest.mjs` (writes `update.json`). Keep the `UpdateManifest` type and `release-manifest.mjs` output in sync.

Steps when a change to `rider/` should reach APK users (prepare them; the user pushes the tag):

1. `cd rider && npm version X.Y.Z --no-git-tag-version`
2. Add the `## X.Y.Z — <date>` section with rider-facing bullets to `rider/CHANGELOG.md`, below the intro and above the previous release.
3. Verify: `node scripts/release-manifest.mjs check rider-vX.Y.Z`, `npx tsc -b`, `npm run build`.
4. After merge to `main`, the user runs `git tag rider-vX.Y.Z && git push origin rider-vX.Y.Z`.
