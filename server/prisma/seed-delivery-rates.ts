import "dotenv/config";
import prisma from "../src/lib/prisma";

// Adds a flat delivery rate of Rs. 155 (covering up to 2 kg, no extra-weight
// surcharge) to the destinations Biratnagar, Bhaktapur and Pokhara, from every
// other active location — so an order to any of these works regardless of which
// vendor hub it originates from. Idempotent via upsert on (origin, destination).

const BASE_CHARGE = 155;
const FREE_WEIGHT_KG = 2;
const DESTINATION_KEYWORDS = ["biratnagar", "bhaktapur", "pokhara"];

async function main() {
  console.log("🌱 Seeding delivery rates (Rs. 155 / 2 kg)...");

  const locations = await prisma.locations.findMany({ where: { is_active: true } });

  const destinations = locations.filter((loc) =>
    DESTINATION_KEYWORDS.some((kw) =>
      `${loc.name} ${loc.city ?? ""} ${loc.district ?? ""}`.toLowerCase().includes(kw),
    ),
  );

  if (destinations.length === 0) {
    console.log("⚠️  No matching destination locations found.");
    return;
  }

  const admin = await prisma.users.findFirst({
    where: { user_roles: { some: { roles: { code: { in: ["super_admin", "admin"] } } } } },
    select: { id: true },
  });

  let count = 0;
  for (const dest of destinations) {
    for (const origin of locations) {
      if (origin.id === dest.id) continue;
      await prisma.delivery_rates.upsert({
        where: {
          origin_location_id_destination_location_id: {
            origin_location_id: origin.id,
            destination_location_id: dest.id,
          },
        },
        update: {
          base_charge: BASE_CHARGE,
          free_weight_kg: FREE_WEIGHT_KG,
          extra_weight_percent: 0,
          is_active: true,
        },
        create: {
          origin_location_id: origin.id,
          destination_location_id: dest.id,
          base_charge: BASE_CHARGE,
          free_weight_kg: FREE_WEIGHT_KG,
          extra_weight_percent: 0,
          is_active: true,
          created_by: admin?.id ?? null,
        },
      });
      count++;
    }
    console.log(`📍 ${dest.name}: rates set from ${locations.length - 1} origins`);
  }

  console.log(`🏁 Done. ${count} rate(s) upserted at Rs. ${BASE_CHARGE} for ${FREE_WEIGHT_KG} kg.`);
}

main()
  .catch((e) => {
    console.error("❌ Error seeding delivery rates:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
