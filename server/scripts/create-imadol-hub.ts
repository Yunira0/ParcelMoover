// One-off: ensure the Imadol admin hub exists. Orders originate from this hub.
// Safe to re-run — upserts by unique code, or creates if missing.
import "dotenv/config";
import prisma from "../src/lib/prisma";

async function main() {
  const existing = await prisma.locations.findFirst({
    where: {
      OR: [
        { code: "IMADOL" },
        { name: { equals: "Imadol", mode: "insensitive" }, parent_id: null },
      ],
    },
  });

  const data = {
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
    parent_id: null,
  };

  if (existing) {
    const loc = await prisma.locations.update({
      where: { id: existing.id },
      data: { ...data, updated_at: new Date() },
    });
    console.log("Updated Imadol hub:", loc.id);
  } else {
    const loc = await prisma.locations.create({ data });
    console.log("Created Imadol hub:", loc.id);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
