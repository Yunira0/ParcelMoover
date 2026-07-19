// One-off data fix: ensure the Imadol hub location exists and the REAL super
// admin (superadmin@parcelmoover.com) is assigned to it. Idempotent — safe to
// re-run. Matches the Imadol definition in seed.ts (Lalitpur / Bagmati).
//
// Usage: npx ts-node --transpile-only prisma/set-superadmin-hub-imadol.ts
//        [SUPERADMIN_EMAIL=...] npx ts-node --transpile-only prisma/set-superadmin-hub-imadol.ts
import "dotenv/config";
import prisma from "../src/lib/prisma";

const SUPERADMIN_EMAIL = process.env.SUPERADMIN_EMAIL || "superadmin@parcelmoover.com";

async function main() {
  // 1. Ensure the Imadol hub exists. Match by code (stable) and fall back to
  //    name. Mirrors the seed.ts definition so the two never drift.
  const imadol = await prisma.locations.upsert({
    where: { code: "IMADOL" },
    update: {},
    create: {
      name: "Imadol",
      code: "IMADOL",
      province: "Bagmati",
      district: "Lalitpur",
      city: "Lalitpur",
      address_line: "Imadol, Lalitpur",
      latitude: 27.6606,
      longitude: 85.3413,
      is_hub: true,
      is_active: true,
    },
  });
  console.log(`📍 Imadol hub ready: id=${imadol.id}, code=${imadol.code}, active=${imadol.is_active}`);

  // 2. Locate the real super admin.
  const user = await prisma.users.findUnique({ where: { email: SUPERADMIN_EMAIL } });
  if (!user) {
    console.error(`No user found with email ${SUPERADMIN_EMAIL}. Aborting.`);
    process.exit(1);
  }

  // 3. Upsert the admins row so it exists even if create-superadmin.ts was
  //    used (which creates an admins row with no location_id). Updates the
  //    hub only — leaves position/other fields untouched.
  const admin = await prisma.admins.upsert({
    where: { user_id: user.id },
    create: { user_id: user.id, location_id: imadol.id },
    update: { location_id: imadol.id, updated_at: new Date() },
    include: { locations: true },
  });

  console.log(`✅ ${SUPERADMIN_EMAIL} (admins.id=${admin.id}) hub set to: ${admin.locations?.name ?? "NULL"}`);
  console.log("\nDone. The super admin's profile hub is now Imadol.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
