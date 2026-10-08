// Credit-limit usage math, shared by vendor and admin surfaces.
//
// Balance is negative when the vendor owes the office. `owed` is the positive
// amount outstanding; `pct` is owed / limit clamped to 0–100 for the bar.

export function creditOwed(balance: number): number {
  return Math.max(0, -balance);
}

export function creditUsagePct(balance: number, creditLimit: number): number {
  if (!Number.isFinite(balance) || !Number.isFinite(creditLimit) || creditLimit <= 0) return 0;
  const pct = (creditOwed(balance) / creditLimit) * 100;
  return Math.min(100, Math.max(0, pct));
}
