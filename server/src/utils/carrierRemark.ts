/**
 * Inbound carrier-staff comments (written by ncm.service.ts's comment sync)
 * carry a bracketed tag so the ingestion path can tell them apart from
 * vendor-posted remarks. The tag is internal bookkeeping and must never reach
 * the UI raw: strip it for display and attribute the remark to a generic
 * "Staff", since these rows are stored with user_id: null and would otherwise
 * fall back to "Unknown".
 *
 * The label was rebranded from the carrier's name to "Courier partner" (see
 * CARRIER_LABEL in ncm.service.ts, and scripts/debrand-carrier-remarks.ts which
 * rewrote the rows already in the database). Both spellings are matched: the
 * debrand script is a one-shot migration, so any environment that has not run
 * it still holds legacy "[NCM Staff]" rows.
 *
 * This lives in one place on purpose. The prefix used to be redeclared beside
 * each consumer, and when the rebrand changed what gets written those copies
 * were left behind - so the tag stopped matching, leaked into the remark text,
 * and every carrier comment showed as authored by "Unknown".
 */
const CARRIER_STAFF_PREFIXES = ["[Courier partner]", "[NCM Staff]"] as const;

export type StrippedRemark = { text: string; isCarrierStaff: boolean };

export function stripCarrierStaffTag(remark: string): StrippedRemark {
  const prefix = CARRIER_STAFF_PREFIXES.find((candidate) => remark.startsWith(candidate));
  if (!prefix) return { text: remark, isCarrierStaff: false };
  return { text: remark.slice(prefix.length).trim(), isCarrierStaff: true };
}
