// Demo accountant for local testing: an admins-profile account in the
// "Accountant" department holding the `accountant` role instead of `admin`,
// exactly what registerUserBySuperAdmin produces for that department (see
// syncSalesRoleForDepartment in auth.service.ts). Head office hub, like the
// real accounts team.
//
// Usage: npm run seed:accountant
import "dotenv/config";
import * as bcrypt from "bcrypt";
import prisma from "../src/lib/prisma";

const DEMO_EMAIL = "accountant.demo@parcelmoover.com";
const DEMO_PASSWORD = "DemoPass123!";
const HEAD_OFFICE_HUB = "Imadol";

async function main() {
  if (process.env.NODE_ENV === "production") {
    console.error("Refusing to run demo accountant seed with NODE_ENV=production.");
    process.exit(1);
  }

  const role = await prisma.roles.findUnique({ where: { code: "accountant" } });
  if (!role) throw new Error('The "accountant" role is missing - run prisma migrate deploy first.');

  const hub = await prisma.locations.findFirst({ where: { name: HEAD_OFFICE_HUB, is_hub: true } });
  if (!hub) throw new Error(`Hub location not found: ${HEAD_OFFICE_HUB}`);

  const user = await prisma.users.upsert({
    where: { email: DEMO_EMAIL },
    update: {},
    create: {
      full_name: "Demo Accountant",
      email: DEMO_EMAIL,
      phone: "+9779843000001",
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
      position: "Accountant",
      department: "Accountant",
      joined_at: new Date(),
    },
  });

  await prisma.user_roles.upsert({
    where: { user_id_role_id: { user_id: user.id, role_id: role.id } },
    update: {},
    create: { user_id: user.id, role_id: role.id },
  });

  console.log(`Seeded ${DEMO_EMAIL} (accountant, ${HEAD_OFFICE_HUB}).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
