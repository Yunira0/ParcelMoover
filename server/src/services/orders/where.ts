import { parcel_status, Prisma } from "../../generated/prisma/client";
import { ListOrdersQuery } from "../../types/order.type";
import { nepalDayRangeUtc } from "../../utils/nepalTime";
import { branchHandlesFilter, riderCustodyFilter } from "./scope";

// The list UI labels every row with its order_number as "#2980", so that's what
// a user types to look one up. order_number is an int column, not part of the
// search_text trigram blob, so it needs its own equality match.
// Capped at 9 digits to stay inside int4 - a longer run of digits is a phone
// number, and passing it to Prisma as an Int would throw.
const ORDER_NUMBER_TERM = /^#?(\d{1,9})$/;
export function parseOrderNumber(term: string): number | null {
  const match = ORDER_NUMBER_TERM.exec(term);
  return match ? Number(match[1]) : null;
}

// Normalize text pasted from spreadsheets, including phone punctuation and
// grouped numbers such as 9,800,000,011.
const INVISIBLE_CHARS = /[​-‍⁠﻿]/g;
const GROUPED_NUMBER = /^\d{1,3}(,\d{3})+$/;
const PHONE_LIKE = /^\+?[\d\s\-().]+$/;
const MIN_PHONE_DIGITS = 7;

function cleanSearchText(text: string): string {
  return text.replace(INVISIBLE_CHARS, "").replace(/ /g, " ").trim();
}

function normalizeSearchTerm(term: string): string {
  const cleaned = cleanSearchText(term);
  const digits = cleaned.replace(/\D/g, "");
  return PHONE_LIKE.test(cleaned) && digits.length >= MIN_PHONE_DIGITS ? digits : cleaned;
}

function splitSearchTerms(search: string): string[] {
  const cleaned = cleanSearchText(search);
  if (GROUPED_NUMBER.test(cleaned) && cleaned.replace(/\D/g, "").length >= MIN_PHONE_DIGITS) {
    return [cleaned.replace(/,/g, "")];
  }
  return cleaned.split(/[,\r\n\t]+/).map(normalizeSearchTerm).filter(Boolean);
}

function isPhoneTerm(term: string): boolean {
  return term.length >= MIN_PHONE_DIGITS && /^\d+$/.test(term);
}

export function buildOrdersWhere(
  scope: {
    vendorId: string | undefined;
    vendorIds?: string[] | undefined;
    riderId: string | undefined;
    branchLocationIds?: string[] | undefined;
  },
  query: ListOrdersQuery,
): Prisma.parcelsWhereInput {
  // The trash view is the one place that wants soft-deleted rows; everywhere
  // else `deleted_at: null` is what keeps them hidden.
  const conditions: Prisma.parcelsWhereInput[] = [
    query.trashed ? { deleted_at: { not: null } } : { deleted_at: null },
  ];

  if (scope.vendorId) {
    conditions.push({ vendor_id: scope.vendorId });
  }
  // Sales accounts are scoped to a set of owned vendors. An empty set means
  // they own no clients yet, so they should see nothing.
  if (scope.vendorIds) {
    conditions.push({ vendor_id: { in: scope.vendorIds } });
  }
  if (scope.riderId) {
    conditions.push(riderCustodyFilter(scope.riderId));
  }
  // A branch-scoped admin (see getAdminBranchScope): the order list shows only
  // parcels the branch actually handles - originated here, or physically here
  // now. An inbound parcel still at another hub pre-pickup is excluded until it
  // reaches the branch (see branchHandlesFilter).
  if (scope.branchLocationIds) {
    conditions.push(branchHandlesFilter(scope.branchLocationIds));
  }
  if (query.status?.length) {
    // secondaryOrderType/secondaryStatus let one query cover both a plain
    // status match and a different-order-type-with-different-status match at
    // once (see the type's own doc comment) - e.g. Return Operations'
    // ready_to_return tab, which needs a true RTO parcel by status alone OR a
    // reverse-shipment order still mid-delivery by order_type + status.
    conditions.push(
      query.secondaryOrderType && query.secondaryStatus?.length
        ? {
            OR: [
              { status: { in: query.status as parcel_status[] } },
              { order_type: query.secondaryOrderType, status: { in: query.secondaryStatus as parcel_status[] } },
            ],
          }
        : { status: { in: query.status as parcel_status[] } },
    );
  }
  if (query.orderType) {
    conditions.push({ order_type: query.orderType });
  }
  // Explicit vendor filter from the UI. Pushed into the query (rather than
  // filtered client-side over one page) so pagination, totals and the tab
  // counts all reflect the selected vendors. It's a separate AND condition
  // from the scope ones above, so a vendor/sales actor can only ever narrow
  // their own scope with it, never escape it.
  if (query.vendorId?.length) {
    conditions.push({ vendor_id: { in: query.vendorId } });
  }
  // Sales filter from the UI: narrow to parcels whose vendor is assigned to
  // this sales user (vendors.sales_user_id). Like the vendor filter it's a
  // separate AND condition, so a vendor/sales actor can only ever narrow their
  // own scope with it, never escape it.
  if (query.salesUserId) {
    conditions.push({ vendors: { sales_user_id: query.salesUserId } });
  }
  if (query.deliveryRiderId) {
    conditions.push({ delivery_rider_id: query.deliveryRiderId });
  }
  if (query.originLocationIds?.length) {
    conditions.push({ origin_location_id: { in: query.originLocationIds } });
  }
  if (query.destinationLocationIds?.length) {
    conditions.push({ destination_location_id: { in: query.destinationLocationIds } });
  }
  // Same local-midnight anchor getDashboardSummary uses for todays_delivered,
  // so the "Delivered today" card and its drill-down can't disagree.
  if (query.deliveredToday) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    conditions.push({ delivered_at: { gte: todayStart } });
  }

  // Date range, bucketed by Nepal-local day so it agrees with the dates the
  // list itself renders (mapOrder formats createdAt the same way).
  const dayRange = nepalDayRangeUtc(query.dateFrom, query.dateTo);
  if (dayRange.gte || dayRange.lt) {
    if (query.dateField === "lastUpdatedAt") {
      // "Status updated" is the newest parcel_status_history row, falling back
      // to updated_at for a parcel that has none - the same value mapOrder
      // reports as lastUpdatedAt. `some(>= from)` + `none(>= to)` pins the
      // *latest* row into the window; `some` alone would also match an order
      // that merely passed through it on the way to a later status.
      const latestInRange: Prisma.parcelsWhereInput[] = [];
      if (dayRange.gte) {
        latestInRange.push({ parcel_status_history: { some: { created_at: { gte: dayRange.gte } } } });
      }
      if (dayRange.lt) {
        latestInRange.push({ parcel_status_history: { none: { created_at: { gte: dayRange.lt } } } });
      }
      conditions.push({
        OR: [
          { AND: latestInRange },
          { AND: [{ parcel_status_history: { none: {} } }, { updated_at: dayRange }] },
        ],
      });
    } else {
      conditions.push({ created_at: dayRange });
    }
  }

  const terms = query.search ? splitSearchTerms(query.search) : [];
  if (terms.length) {
    const search = terms[0] ?? "";
    if (terms.length > 1) {
      // A scan batch is tracking ids, but the same box accepts a pasted list of
      // order ids, so "#2980" in the list resolves too. Bare numbers stay
      // tracking-id-only here - in a scan batch they're far likelier to be a
      // mis-scan than an order id.
      const orderNumbers = terms
        .filter((t) => t.startsWith("#"))
        .map(parseOrderNumber)
        .filter((n): n is number => n !== null);
      conditions.push({
        OR: [
          ...terms.map((t) => ({ tracking_id: { equals: t, mode: "insensitive" as const } })),
          ...terms.filter(isPhoneTerm).map((t) => ({ search_text: { contains: t } })),
          ...(orderNumbers.length ? [{ order_number: { in: orderNumbers } }] : []),
        ],
      });
    } else {
      const orderNumber = parseOrderNumber(search);
      if (orderNumber !== null && search.startsWith("#")) {
        // "#2980" is unambiguous - the user wants that one order, so don't
        // dilute it with the phone numbers that contain 2980.
        conditions.push({ order_number: orderNumber });
      } else {
        // Single-column GIN trigram search — no JOINs, stays fast at any table size.
        // Covers: tracking_id, sender/receiver name, sender/receiver phone.
        // A bare number could be either, so try it as an order id as well.
        conditions.push({
          OR: [
            { search_text: { contains: search.toLowerCase(), mode: "insensitive" as const } },
            ...(orderNumber !== null ? [{ order_number: orderNumber }] : []),
          ],
        });
      }
    }
  }

  // Merchant overview settlement filter — authentic: only parcels that are
  // linked via settlement_items to a settled vendor settlement count as
  // deposited. Pending = delivered not in any settled settlement.
  // This filters out empty settlements (e.g. STL-2024-001 with 0 items).
  if (query.settlement === "settled") {
    conditions.push({
      cod_collections: {
        settlement_items: {
          some: {
            settlements: { status: "settled", payee_type: "vendor" },
          },
        },
      },
    });
  } else if (query.settlement === "pending") {
    conditions.push({
      OR: [
        { cod_collections: null },
        {
          cod_collections: {
            settlement_items: {
              none: {
                settlements: { status: "settled", payee_type: "vendor" },
              },
            },
          },
        },
      ],
    });
  }

  if (query.branchSettlement === "settled") {
    conditions.push({ branch_settlement_items: { some: { settlement: { status: "settled" } } } });
  } else if (query.branchSettlement === "pending") {
    // Pending cash includes both parcels not yet statemented and parcels on an
    // unpaid/part-paid statement. Only a completed branch payment is a deposit.
    conditions.push({ branch_settlement_items: { none: { settlement: { status: "settled" } } } });
  } else if (query.branchSettlement === "unassigned") {
    // The Add Settlement picker must not offer a parcel already earmarked by a
    // pending statement; membership is the double-statement guard.
    conditions.push({ branch_settlement_items: { none: {} } });
  }

  return { AND: conditions };
}
