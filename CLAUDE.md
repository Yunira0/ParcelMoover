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
