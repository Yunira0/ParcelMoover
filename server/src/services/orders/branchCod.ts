import { Prisma } from "../../generated/prisma/client";

// Which delivered parcels count as *branch* COD: the cash a branch collected on
// parcels that reached it through a transit manifest. Parcels a 3PL carrier
// (NCM / Upaya) delivered are settled on that carrier's own statements, so they
// stay out of branch COD everywhere it is counted, listed or statemented.
export const BRANCH_COD_PARCEL_FILTER: Prisma.parcelsWhereInput = {
  transit_manifest_parcels: { some: {} },
  NOT: { cod_collections: { carrier_code: { not: null } } },
};

/** Raw-SQL form of BRANCH_COD_PARCEL_FILTER; `alias` is the parcels alias, e.g. "p.". */
export function branchCodParcelSql(alias = ""): Prisma.Sql {
  const id = Prisma.raw(`${alias}id`);
  return Prisma.sql`AND EXISTS (SELECT 1 FROM transit_manifest_parcels tmp WHERE tmp.parcel_id = ${id})
    AND NOT EXISTS (SELECT 1 FROM cod_collections ccx WHERE ccx.parcel_id = ${id} AND ccx.carrier_code IS NOT NULL)`;
}
