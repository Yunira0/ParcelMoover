// Demo Operation and Customer Experience admins for local testing: plain
// `admin` accounts whose department narrows the web shell to that department's
// pages (see utils/departmentWorkspace.ts and client utils/auth.ts). Head
// office hub, so they are not branch-scoped.
//
// Usage: npm run seed:department-admins
import "dotenv/config";
import * as bcrypt from "bcrypt";
import prisma from "../src/lib/prisma";

const DEMO_PASSWORD = "DemoPass123!";
const HEAD_OFFICE_HUB = "Imadol";
const DEMO_ADMINS = [
  { email: "operation.demo@parcelmoover.com", name: "Demo Operation", phone: "+9779843000002", department: "Operation" },
  { email: "cx.demo@parcelmoover.com", name: "Demo Customer Experience", phone: "+9779843000003", department: "Customer Experience" },
];

async function main() {
  if (process.env.NODE_ENV === "production") {
    console.error("Refusing to run demo department admin seed with NODE_ENV=production.");
    process.exit(1);
  }

  const role = await prisma.roles.findUnique({ where: { code: "admin" } });
  if (!role) throw new Error('The "admin" role is missing - run prisma migrate deploy first.');

  const hub = await prisma.locations.findFirst({ where: { name: HEAD_OFFICE_HUB, is_hub: true } });
  if (!hub) throw new Error(`Hub location not found: ${HEAD_OFFICE_HUB}`);

  for (const demo of DEMO_ADMINS) {
    const user = await prisma.users.upsert({
      where: { email: demo.email },
      update: {},
      create: {
        full_name: demo.name,
        email: demo.email,
        phone: demo.phone,
        status: "active",
        password_hash: await bcrypt.hash(DEMO_PASSWORD, 10),
      },
    });

    await prisma.admins.upsert({
      where: { user_id: user.id },
      update: {},
      create: {
        user_id: user.id,
        location_id: hub.id,
        position: demo.department,
        department: demo.department,
        joined_at: new Date(),
      },
    });

    await prisma.user_roles.upsert({
      where: { user_id_role_id: { user_id: user.id, role_id: role.id } },
      update: {},
      create: { user_id: user.id, role_id: role.id },
    });

    console.log(`Seeded ${demo.email} (admin, ${demo.department}, ${HEAD_OFFICE_HUB}).`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
