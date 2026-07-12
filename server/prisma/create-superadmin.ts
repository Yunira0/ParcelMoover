// One-off bootstrap for a REAL first super admin — deliberately separate
// from seed.ts, which hardcodes "DemoPass123!" for every demo account
// (including its super admin) and must never be run against production.
//
// Generates a random password, prints it to the terminal exactly once, and
// sets must_change_password so the app forces a real password on first
// login via the existing ForceChangePasswordPage flow.
//
// Usage: SUPERADMIN_EMAIL=you@yourcompany.com npx ts-node --transpile-only prisma/create-superadmin.ts
import "dotenv/config";
import crypto from "crypto";
import * as bcrypt from "bcrypt";
import prisma from "../src/lib/prisma";

async function main() {
  const email = process.env.SUPERADMIN_EMAIL;
  if (!email) {
    console.error("Set SUPERADMIN_EMAIL to the real admin's email before running this.");
    process.exit(1);
  }

  const existing = await prisma.users.findUnique({ where: { email } });
  if (existing) {
    console.error(`A user with email ${email} already exists (id: ${existing.id}). Aborting.`);
    process.exit(1);
  }

  const password = crypto.randomBytes(18).toString("base64url");
  const password_hash = await bcrypt.hash(password, 10);

  const superAdminRole = await prisma.roles.upsert({
    where: { code: "super_admin" },
    update: {},
    create: { code: "super_admin", name: "Super Admin", description: "Full system access" },
  });

  const user = await prisma.users.create({
    data: {
      full_name: "Super Administrator",
      email,
      status: "active",
      password_hash,
      must_change_password: true,
    },
  });

  await prisma.admins.create({
    data: { user_id: user.id, position: "Super Administrator" },
  });

  await prisma.user_roles.create({
    data: { user_id: user.id, role_id: superAdminRole.id },
  });

  console.log("\n==============================================================");
  console.log("Super admin created. This password is shown ONCE — save it now:");
  console.log(`  email:    ${email}`);
  console.log(`  password: ${password}`);
  console.log("The app will force a password change on first login.");
  console.log("==============================================================\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
