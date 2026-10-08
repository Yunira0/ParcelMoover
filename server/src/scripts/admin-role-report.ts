// Lists admin accounts whose access (role) doesn't match their department, and
// with --apply gives each the role its department implies.
//
// Department decides the role on creation and on every edit, but accounts
// edited before that rule - or created before the Sales/Accountant roles
// existed - can still disagree, e.g. "Accountant" on an account with full admin
// access. Super admins are never touched.
//
//   npm run admins:role-report                  read-only report
//   npm run admins:role-report -- --apply       align each one (audited)
//   node dist/scripts/admin-role-report.js ...  (production)
//   add --fail-on-mismatch to exit 1 when any account disagrees (post-deploy check)
import "dotenv/config";
import prisma from "../lib/prisma";
import { alignRoleToDepartment, roleForDepartment } from "../services/auth.service";

const BASE_ROLES = ["admin", "accountant", "sales"];

async function main() {
  const admins = await prisma.admins.findMany({
    where: { users: { deleted_at: null } },
    select: {
      id: true,
      user_id: true,
      department: true,
      position: true,
      users: { select: { full_name: true, email: true, user_roles: { select: { roles: { select: { code: true } } } } } },
    },
    orderBy: { users: { full_name: "asc" } },
  });

  const mismatches = admins.filter((admin) => {
    const roles = admin.users.user_roles.map((userRole) => userRole.roles.code);
    if (roles.includes("super_admin")) return false;
    const base = roles.filter((code) => BASE_ROLES.includes(code));
    return !(base.length === 1 && base[0] === roleForDepartment(admin.department));
  });

  console.log(`${admins.length} admin account(s) checked, ${mismatches.length} where role and department disagree.`);
  if (mismatches.length === 0) return;
  console.table(
    mismatches.map((admin) => ({
      name: admin.users.full_name,
      email: admin.users.email,
      department: admin.department ?? "-",
      designation: admin.position ?? "-",
      role: admin.users.user_roles.map((userRole) => userRole.roles.code).filter((code) => BASE_ROLES.includes(code)).join(", ") || "(none)",
      departmentSuggests: roleForDepartment(admin.department),
    })),
  );

  if (process.argv.includes("--apply")) {
    for (const admin of mismatches) {
      await prisma.$transaction((tx) => alignRoleToDepartment(tx, null, admin.user_id, admin.id, admin.department));
      console.log(`  ${admin.users.full_name}: now ${roleForDepartment(admin.department)}`);
    }
    console.log(`Aligned ${mismatches.length} account(s); each change is in the audit log as CHANGE_ADMIN_ROLE.`);
    return;
  }
  console.log("Read-only: add --apply to give each the role its department implies.");
  if (process.argv.includes("--fail-on-mismatch")) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit();
  });
