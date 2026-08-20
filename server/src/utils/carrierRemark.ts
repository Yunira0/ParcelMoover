/**
 * Inbound carrier-staff comments (written by ncm.service.ts's comment sync)
 * carry a bracketed tag so the ingestion path can tell them apart from
 * vendor-posted remarks. The tag is internal bookkeeping and must never reach
 * the UI raw: strip it for display and attribute the remark to a generic
 * "Staff", since these rows are stored with user_id: null and would otherwise
 * fall back to "Unknown".
 *
 * The label was rebranded from the carrier's name to "Courier partner" (see
 * CARRIER_LABEL below, and scripts/debrand-carrier-remarks.ts which
 * rewrote the rows already in the database). Both spellings are matched: the
 * debrand script is a one-shot migration, so any environment that has not run
 * it still holds legacy "[NCM Staff]" rows.
 *
 * This lives in one place on purpose. The prefix used to be redeclared beside
 * each consumer, and when the rebrand changed what gets written those copies
 * were left behind - so the tag stopped matching, leaked into the remark text,
 * and every carrier comment showed as authored by "Unknown".
 */
/**
 * The neutral name every 3PL is shown under. No carrier's own brand belongs in
 * a vendor- or customer-visible string, and the two carriers each used to spell
 * this for themselves - so NCM's status updates read "Courier partner: ..." and
 * Upaya's read "Upaya: ...", in the same timeline.
 */
export const CARRIER_LABEL = "Courier partner";

/** upaya.service.ts tags its inbound comments with this. Exported so that
 *  service can import the spelling instead of declaring its own copy - the
 *  drift described above is exactly how it came to be missing from this list. */
export const UPAYA_STAFF_PREFIX = "[Upaya Staff]";

const CARRIER_STAFF_PREFIXES = [`[${CARRIER_LABEL}]`, "[NCM Staff]", UPAYA_STAFF_PREFIX] as const;

/** Shown in place of a name for anything a carrier wrote. */
export const CARRIER_AUTHOR_LABEL = "Staff";

/**
 * The name to show for a remark's author.
 *
 * Carrier rows are stored with user_id: null, so there is no name to show. They
 * used to fall back to "Unknown", which reads like data corruption rather than
 * "a 3PL wrote this" - and the fallback only worked when the remark text
 * carried a recognised tag, so an unregistered prefix leaked "Unknown" through.
 * Keying off the missing author instead means any carrier, tagged or not, and
 * any carrier added later, all read as Staff.
 */
export function displayAuthor(
  fullName: string | null | undefined,
  isCarrierStaff = false,
): string {
  return isCarrierStaff || !fullName ? CARRIER_AUTHOR_LABEL : fullName;
}

/**
 * What a carrier-written status update is prefixed with, e.g.
 * "Staff: delivered (reconciled)". Both carriers write this; older rows say
 * "Courier partner: ...", "NCM: ..." or "Upaya: ...", all normalised below.
 */
export const STATUS_REMARK_PREFIXES_LEGACY = [
  `${CARRIER_LABEL}:`,
  "NCM:",
  "Upaya:",
] as const;

/**
 * The handoff remark - "Parcel dispatched to destination - order #123 -> hub".
 *
 * This string is NOT decoration: it is the durable parcel -> carrier-order
 * mapping, matched by startsWith/regex in both carrier services and by two raw
 * SQL sums in order.service that split COD between the carriers. Upaya's rows
 * were written with a branded spelling and cannot be rewritten in place without
 * orphaning every in-flight parcel from its carrier order - so the stored text
 * stays as it is and the brand is removed on the way out, in displayRemarkText.
 */
export const HANDOFF_REMARK_PREFIX = "Parcel dispatched to destination";
export const UPAYA_HANDOFF_REMARK_PREFIX = "Parcel dispatched via Upaya";

/**
 * Normalises stored remark text for display: one wording for both carriers, and
 * no carrier's own name. Applied on read rather than on write because the rows
 * it rewrites are load-bearing (see HANDOFF_REMARK_PREFIX) or already written.
 */
export function displayRemarkText(remark: string): string {
  if (remark.startsWith(UPAYA_HANDOFF_REMARK_PREFIX)) {
    return HANDOFF_REMARK_PREFIX + remark.slice(UPAYA_HANDOFF_REMARK_PREFIX.length);
  }
  const stale = STATUS_REMARK_PREFIXES_LEGACY.find((candidate) => remark.startsWith(candidate));
  if (stale) return `${CARRIER_AUTHOR_LABEL}:${remark.slice(stale.length)}`;
  return remark;
}

export type StrippedRemark = { text: string; isCarrierStaff: boolean };

export function stripCarrierStaffTag(remark: string): StrippedRemark {
  const prefix = CARRIER_STAFF_PREFIXES.find((candidate) => remark.startsWith(candidate));
  if (!prefix) return { text: displayRemarkText(remark), isCarrierStaff: false };
  return { text: displayRemarkText(remark.slice(prefix.length).trim()), isCarrierStaff: true };
}
