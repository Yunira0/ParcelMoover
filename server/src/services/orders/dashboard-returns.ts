import { Prisma } from "../../generated/prisma/client";

// Keep the enum native so the status/date index can service both queries.
// Scope is built by dashboard.ts from the authenticated actor, never from SQL
// supplied by a request. Distinct parcels are counted once per Nepal day.
export function buildReturnedTodayQuery(start: Date, scope: Prisma.Sql) {
  return Prisma.sql`
    SELECT COUNT(DISTINCT h.parcel_id) AS count
    FROM parcel_status_history h JOIN parcels p ON p.id = h.parcel_id
    WHERE h.new_status = 'returned_to_vendor'::parcel_status
      AND h.created_at >= ${start} AND p.deleted_at IS NULL
      ${scope}
  `;
}

export function buildReturnedTrendQuery(ranges: { start: Date; end: Date }[], scope: Prisma.Sql) {
  if (!ranges.length) throw new Error("Return trend needs at least one day");
  const columns = ranges.map(({ start, end }, i) => Prisma.sql`
    COUNT(DISTINCT h.parcel_id) FILTER (WHERE h.created_at >= ${start} AND h.created_at < ${end}) AS ${Prisma.raw(`d${i}_returned`)}
  `);
  return Prisma.sql`
    SELECT ${Prisma.join(columns, ",")}
    FROM parcel_status_history h JOIN parcels p ON p.id = h.parcel_id
    WHERE h.new_status = 'returned_to_vendor'::parcel_status
      AND h.created_at >= ${ranges[0]!.start} AND h.created_at < ${ranges[ranges.length - 1]!.end}
      AND p.deleted_at IS NULL
      ${scope}
  `;
}
