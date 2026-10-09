# PM Rider changelog

Every Android release needs a section here **before** you push its tag. The
bullets become the "What's new" list riders see in the update popup, so write
them for riders, not developers (short, plain words, no ticket numbers).

Format — the heading must match `rider/package.json` "version":

```
## 1.5.0 — 2026-10-20
- Something riders will notice
- Another thing
```

Add `(required)` to the heading (`## 1.5.0 — 2026-10-20 (required)`) when
older versions must update before they can keep working, e.g. after an API
change they can't handle. Riders on older versions then get a popup with no
"Later" button.

## 1.4.3 — 2026-10-09
- Small improvements behind the scenes to help us support you better

## 1.4.2 — 2026-10-08
- The app now opens with the ParcelMoover logo

## 1.4.1 — 2026-10-07
- The app now updates itself: you'll see a popup when a new version is ready
- Updates install over the current app, so you stay logged in
- See your app version and check for updates from Profile
