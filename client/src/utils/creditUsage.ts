// Credit-limit usage math, shared by vendor and admin surfaces.
//
// Balance is negative when the vendor owes the office. `owed` is the positive
// amount outstanding; `pct` is owed / limit clamped to 0–100 for the bar.
// The block line itself is inclusive (balance <= -limit still counts as
// blocked), so the amount that actually lifts a block is a paisa more than
// the server's `amountToClearBlock` — paying exactly the suggested figure
// lands exactly on the line and stays blocked (see docs/VENDOR_CREDIT_EDGE_CASES.md).

export function creditOwed(balance: number): number {
  return Math.max(0, -balance);
}

export function creditUsagePct(balance: number, creditLimit: number): number {
  if (!Number.isFinite(balance) || !Number.isFinite(creditLimit) || creditLimit <= 0) return 0;
  const pct = (creditOwed(balance) / creditLimit) * 100;
  return Math.min(100, Math.max(0, pct));
}

// The figure a blocked vendor must actually pay to resume ordering.
// Server `amountToClearBlock` is owed − limit; paying exactly that lands on
// the inclusive block line, so suggest one paisa more (rounded to paise).
export function payToClearBlock(amountToClearBlock: number): number {
  if (!Number.isFinite(amountToClearBlock) || amountToClearBlock <= 0) return 0;
  return (Math.round(amountToClearBlock * 100) + 1) / 100;
}
