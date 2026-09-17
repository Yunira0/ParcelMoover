# Vouchers

Daraz-style shipping discounts. A super admin publishes an offer such as MOVE100 — Rs. 100 off — at `/vouchers`; vendors browse the offer cards, claim one into "My Vouchers" (by card or by code), then pick it or type its code while creating an order. The order shows the delivery fee, voucher discount, and final charge before submission. Claiming requires an approved KYC application: approval links the vendor through a KYC_APPROVE audit record to a currently approved KYC application. Legacy vendors without that explicit link are ineligible.

Vendors without approved KYC verify through a manually filled form on either side, sharing one component and one validation: the vendor fills it on the Vouchers page (owner email locked to the account), and staff fill it from a Start KYC action on the vendor's row in Vendor Management — shown only while that vendor still needs it (verified and queued vendors get no button). Blanks keep the on-file profile and documents. Both land in the normal KYC Applications queue (`/vendors?tab=kyc`), marked as Verification rather than Onboarding; approving one links the living vendor instead of creating a new account. One pending verification per vendor; already-verified vendors are refused at submit time.

This replaces Parcel Credits. The old grant tables (`promotion_grants`, `promotion_entries`) remain as archived history; no new grants are issued and the `/api/parcel-credits` endpoints are gone.

## Offer rules

- Fixed Rs. 100 off (`discountType: fixed`, `discountAmount: 100`) or percent off (`discountType: percent`, `discountPercent: 10`) with an optional per-order cap (`maxDiscount`). Fixed amounts are Rs. 0.01–5,000; percent is 0.01–100.
- `minimumCharge`: the order's delivery fee must meet it, otherwise the order is rejected with the required minimum. The discount is capped at the fee, so a voucher never pays out.
- `startsAt`/`expiresAt` window plus `claimLimit` (total claims across all vendors). One claim per vendor per offer.
- Published terms are immutable (database trigger) — only pause/resume (`isActive`) and the claim counter may change. To change an offer, pause it and publish a new code.
- Vouchers apply to outbound `delivery` orders only — never exchange, return, or partial-delivery repricing games. They cannot be transferred, withdrawn, or used to pay an existing balance.

## Lifecycle of a claim

Claimed → reserved when attached to a `pickup_ordered` order → used once the order is delivered (partial delivery also consumes it) → released back to claimed if the order is cancelled or trashed. A returned-to-vendor order consumes the claim but zeroes the discount. Every transition appends to `voucher_events`; repricing below the minimum is rejected (cancel and recreate instead). An order already inside a settlement must leave it before its voucher price can change — the settlement snapshot trigger enforces this.

Vouchers do not touch vendor cash/debt balances. A vendor past their block threshold is still blocked from creating orders, voucher or not; verified top-up payments restore access exactly as before (see Billing & Credit Control).

## Accounting and concurrency

`parcels.gross_delivery_charge` is the pre-voucher fee; `discount_amount` is the voucher benefit; `delivery_charge` stays the net fee, so billing, reports, and statement posting recognize net delivery revenue with no extra journal entries.

The pricing trigger reserves the claim and prices the order in one row write; claim creation locks the offer row, so two vendors racing the last spot cannot both take it. Published terms are immutable; `voucher_events` is append-only. Transaction failures roll back the order and the reservation together.

## Campaigns (bulk printed codes)

For handouts — e.g. Dashain 20% off across 100 slips — a super admin creates a **campaign** instead of publishing one shared code. The campaign holds the shared terms plus a batch of unique single-claim codes (`PREFIX-XXXXXX`, unambiguous alphabet, no 0/O or 1/I/L).

- One row per code in `vouchers` (`campaign_id` set, `claim_limit: 1`, `is_listed: false`). Campaign rows carry status only (`active`/`paused`/`ended`), so pausing never rewrites published terms.
- **One claim per vendor per campaign** (`maxPerVendor`, default 1) — collecting five flyers still yields one discount. Enforced at claim time alongside the paused/ended check; spending re-checks campaign status too.
- Campaign codes never appear as vendor browse cards — vendors claim them by code from the slip (scanning the slip QR opens Vouchers with the code prefilled via `?code=`).
- Ending a campaign is terminal; to re-run an offer, create a follow-up campaign.
- Track per code: unclaimed / claimed / redeemed / expired / paused, plus which vendor claimed it and when. CSV export covers records and reprints.
- Print is one job: page 1 is the full campaign poster, then 8-up A4 slips with cut guides.

Unit tests: `npm test -- src/services/__tests__/voucher-campaign.service.test.ts`.

## Run and verify

From `server`: `npx prisma migrate deploy`, then `npm run build` and restart the server if it does not reload automatically. From `client`: `npm run build`.

Unit tests: `npm test -- src/services/__tests__/voucher.service.test.ts`.
