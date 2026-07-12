// Production-safe roles seed — creates/updates only the `roles` table rows.
// Unlike seed.ts (which is blocked in production because it also creates
// demo users with a hardcoded password), this touches no user data and is
// safe to run against any environment, including production.
//
// Usage: npx ts-node --transpile-only prisma/seed-roles.ts
import "dotenv/config";
import prisma from "../src/lib/prisma";

const rolesData = [
  { code: "super_admin", name: "Super Admin", description: "Full system access" },
  { code: "admin", name: "Admin", description: "Branch management" },
  { code: "rider", name: "Rider", description: "Delivery operations" },
  { code: "vendor", name: "Vendor", description: "Merchant access" },
  { code: "sales", name: "Sales", description: "Vendor onboarding" },
  { code: "vendor_staff", name: "Vendor Staff", description: "Vendor sub-account" },
];

async function main() {
  for (const role of rolesData) {
    await prisma.roles.upsert({
      where: { code: role.code },
      update: {},
      create: role,
    });
    console.log(`✅ Role: ${role.code}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
