// Read-only inspection: shows the Imadol location and every super_admin's
// current hub (admins.location_id). Run with:
//   npx ts-node --transpile-only prisma/inspect-superadmin-hub.ts
import "dotenv/config";
import prisma from "../src/lib/prisma";

async function main() {
  const imadol = await prisma.locations.findFirst({
    where: {
      OR: [
        { code: { equals: "IMADOL", mode: "insensitive" } },
        { name: { equals: "Imadol", mode: "insensitive" } },
      ],
    },
  });
  console.log(
    "IMADOL location:",
    imadol
      ? { id: imadol.id, name: imadol.name, code: imadol.code, is_hub: imadol.is_hub, is_active: imadol.is_active }
      : "NOT FOUND",
  );

  const superAdminRole = await prisma.roles.findUnique({ where: { code: "super_admin" } });
  if (!superAdminRole) {
    console.log("\nNo super_admin role found.");
    return;
  }
  const userRoles = await prisma.user_roles.findMany({
    where: { role_id: superAdminRole.id },
    include: { users: { include: { admins: { include: { locations: true } } } } },
  });
  console.log(`\nSuper admin users: ${userRoles.length}`);
  for (const ur of userRoles) {
    const a = ur.users.admins;
    console.log(
      `  - ${ur.users.email} (id=${ur.users.id}) | admins row: ${
        a ? `id=${a.id}, location_id=${a.location_id}, hub=${a.locations?.name ?? "NULL"}` : "NONE"
      }`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
