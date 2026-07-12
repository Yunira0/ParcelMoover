// One-off password reset for when an admin forgets their password and there's
// no forgot-password flow in the app yet. Generates a random password, prints
// it once, and forces a real change on next login (must_change_password).
//
// Usage: RESET_EMAIL=someone@parcelmoover.com npx ts-node --transpile-only prisma/reset-password.ts
import "dotenv/config";
import crypto from "crypto";
import * as bcrypt from "bcrypt";
import prisma from "../src/lib/prisma";

async function main() {
  const email = process.env.RESET_EMAIL;
  if (!email) {
    console.error("Set RESET_EMAIL to the account's email before running this.");
    process.exit(1);
  }

  const user = await prisma.users.findUnique({ where: { email } });
  if (!user) {
    console.error(`No user found with email ${email}.`);
    process.exit(1);
  }

  const password = crypto.randomBytes(18).toString("base64url");
  const password_hash = await bcrypt.hash(password, 10);

  await prisma.users.update({
    where: { id: user.id },
    data: { password_hash, must_change_password: true, updated_at: new Date() },
  });

  console.log("\n==============================================================");
  console.log("Password reset. This password is shown ONCE — save it now:");
  console.log(`  email:    ${email}`);
  console.log(`  password: ${password}`);
  console.log("The app will force a password change on next login.");
  console.log("==============================================================\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
