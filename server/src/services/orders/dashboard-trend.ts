import { Prisma } from "../../generated/prisma/client";

export type TrendDayRange = { start: Date; end: Date };

// A historical parcel may be picked up or delivered during this window even
// when it was created years earlier. Bound each milestone separately; using
// created_at alone would silently remove those pickups and deliveries.
export function buildDashboardTrendQuery(ranges: TrendDayRange[], scope: Prisma.Sql) {
  const first = ranges[0];
  const last = ranges[ranges.length - 1];
  if (!first || !last) throw new Error("A dashboard trend needs at least one day");

  const columns = ranges.map(({ start, end }, i) => Prisma.sql`
    COUNT(*) FILTER (WHERE created_at >= ${start} AND created_at < ${end}) AS ${Prisma.raw(`d${i}_total`)},
    COUNT(*) FILTER (WHERE picked_up_at >= ${start} AND picked_up_at < ${end}) AS ${Prisma.raw(`d${i}_picked_up`)},
    COUNT(*) FILTER (WHERE status::text = ANY(ARRAY['delivered','partially_delivered']) AND delivered_at >= ${start} AND delivered_at < ${end}) AS ${Prisma.raw(`d${i}_delivered`)}
  `);

  return Prisma.sql`
    SELECT ${Prisma.join(columns, ",")} FROM parcels
    WHERE deleted_at IS NULL ${scope}
      AND (
        (created_at >= ${first.start} AND created_at < ${last.end})
        OR (picked_up_at >= ${first.start} AND picked_up_at < ${last.end})
        OR (delivered_at >= ${first.start} AND delivered_at < ${last.end})
      )
  `;
}
