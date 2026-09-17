# Vendor-wise credit limits

Each vendor carries its own credit limit (positive NPR): the cap on unpaid delivery charges. A vendor is warned past the warn threshold and blocked from new orders once what they owe passes their own limit (balance <= -credit limit). Verified top-up payments bring the balance back and restore access immediately.

## Rules

- New vendors are assigned the current system default at creation — stored on their own row, not referenced. Changing the default later applies to later vendors only.
- The default (`billing_settings.default_credit_limit`, NPR 50,000) is editable under Billing & Credit Control → Thresholds & QR (super_admin).
- An admin override (`PATCH /api/billing/vendors/:vendorId/credit-limit`, super_admin, from the Vendor balances tab) touches only that vendor: the default and every other vendor keep their values. The vendor is re-evaluated at once, so a raise lifts a block immediately.
- Limits must be greater than zero (cap NPR 100,000,000), and the default must keep the block line harsher than the warn line, or vendors would be blocked before ever being warned.
- Balances, thresholds, and `amountToClearBlock` keep their existing shapes; responses additionally carry the vendor's `creditLimit`.

## Run and verify

From `server`: `npx prisma migrate deploy`, then `npm run build` and restart the server if it does not reload automatically. From `client`: `npm run build`.

Unit tests: `npm test -- src/services/__tests__/billing.service.test.ts`.
