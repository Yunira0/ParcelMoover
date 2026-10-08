// Lists admin accounts whose access (role) doesn't match their department.
// Read-only: fix each one from the admin edit form's Role field.
//
// Department picks an account's role only when it is created, so a later
// department edit leaves the two apart - e.g. "Sales" on an account that still
// has full admin access.
//
//   npm run admins:role-report          (development)
//   npm run admins:role-report:prod     (production build)
import "dotenv/config";
import prisma from "../lib/prisma";

const BASE_ROLES = ["admin", "accountant", "sales"];
const roleForDepartment = (department: string | null) =>
  ({ sales: "sales", accountant: "accountant" } as Record<string, string>)[(department ?? "").trim().toLowerCase()] ?? "admin";

async function main() {
  const admins = await prisma.admins.findMany({
    where: { users: { deleted_at: null } },
    select: {
      department: true,
      position: true,
      users: { select: { full_name: true, email: true, user_roles: { select: { roles: { select: { code: true } } } } } },
    },
    orderBy: { users: { full_name: "asc" } },
  });

  const mismatches = admins.flatMap((admin) => {
    const roles = admin.users.user_roles.map((userRole) => userRole.roles.code);
    if (roles.includes("super_admin")) return [];
    const base = roles.filter((code) => BASE_ROLES.includes(code));
    const expected = roleForDepartment(admin.department);
    if (base.length === 1 && base[0] === expected) return [];
    return [{
      name: admin.users.full_name,
      email: admin.users.email,
      department: admin.department ?? "-",
      designation: admin.position ?? "-",
      role: base.join(", ") || "(none)",
      departmentSuggests: expected,
    }];
  });

  console.log(`${admins.length} admin account(s) checked, ${mismatches.length} where role and department disagree.`);
  if (mismatches.length > 0) console.table(mismatches);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
