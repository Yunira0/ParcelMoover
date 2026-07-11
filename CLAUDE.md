# CLAUDE.md

## Design Context

`client/` (the ops dashboard) has `PRODUCT.md` and `DESIGN.md` at its root, written by `/impeccable init`. Read them before any UI work in `client/`.

- **Register:** product — this is an operations tool, not a marketing surface.
- **Platform:** web.
- **North Star:** "The Control Tower" — a calm, high-signal command center for watching parcels, money, and people move through pickup → dispatch → delivery → settlement.
- **Users:** two co-equal audiences share the app — internal ops staff (dispatch, admin, finance, CX, KYC) and vendor/merchant self-service users.
- **Key visual rules:** rust (`#c2410c`) is the only warm accent color in the system; same-plane surfaces (tables, cards, panels) separate with a 1px border, not a shadow; body/UI text defaults to medium weight (500) at 14px, not regular.

Full detail, anti-references, and the complete Do's/Don'ts list live in `client/PRODUCT.md` and `client/DESIGN.md`.
