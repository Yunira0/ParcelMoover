import "dotenv/config";
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as jwt from "jsonwebtoken";
import * as bcrypt from "bcrypt";
import prisma from "../src/lib/prisma";

// Seeds throwaway accounts across all five roles for k6 load testing (see
// server/loadtest/), sized so that a realistic-skew simulation of 30,000
// concurrent browsing users doesn't trip the per-actor read rate limiter
// (120 req/min - orderReadLimiter in order.routes.ts) on its own account
// pool. Roughly 1 account is needed per 9 simulated concurrent users at a
// realistic browsing pace (~13 req/min/user) - see server/loadtest/README.md
// for the math. Defaults below assume a 70/15/8/6/1 vendor/rider/sales/
// admin/super_admin split of 30,000 users.
const COUNTS = {
  vendor: Number(process.env.LOADTEST_VENDOR_COUNT) || 2500,
  rider: Number(process.env.LOADTEST_RIDER_COUNT) || 500,
  sales: Number(process.env.LOADTEST_SALES_COUNT) || 300,
  admin: Number(process.env.LOADTEST_ADMIN_COUNT) || 200,
  super_admin: Number(process.env.LOADTEST_SUPERADMIN_COUNT) || 40,
} as const;

type Role = keyof typeof COUNTS;

// Distinct phone prefixes per role so ranges never collide with each other
// or with the main/demo seed data.
const PHONE_PREFIX: Record<Role, string> = {
  vendor: "+97798900",
  rider: "+97798901",
  sales: "+97798902",
  admin: "+97798903",
  super_admin: "+97798904",
};

const EMAIL_SLUG: Record<Role, string> = {
  vendor: "vendor",
  rider: "rider",
  sales: "sales",
  admin: "admin",
  super_admin: "superadmin",
};

const PASSWORD = process.env.LOADTEST_PASSWORD || "LoadTest123!";
const CONCURRENCY = 20;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error("🔴 JWT_SECRET is not set - required to mint load-test session tokens.");
  process.exit(1);
}

type PoolEntry = { role: Role; email: string; userId: string; token: string };

async function runBatched<T>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<void>) {
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      await fn(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

async function ensureRole(code: Role, name: string, description: string) {
  return prisma.roles.upsert({
    where: { code },
    update: {},
    create: { code, name, description },
  });
}

async function createAccount(role: Role, index: number, roleId: string, passwordHash: string): Promise<PoolEntry> {
  const idx = String(index).padStart(4, "0");
  const email = `loadtest-${EMAIL_SLUG[role]}-${idx}@loadtest.local`;
  const phone = `${PHONE_PREFIX[role]}${idx}`;
  const fullName = `Loadtest ${EMAIL_SLUG[role]} ${idx}`;

  const userId = await prisma.$transaction(async (tx) => {
    const user = await tx.users.upsert({
      where: { email },
      update: {},
      create: { full_name: fullName, email, phone, password_hash: passwordHash, status: "active" },
    });

    await tx.user_roles.upsert({
      where: { user_id_role_id: { user_id: user.id, role_id: roleId } },
      update: {},
      create: { user_id: user.id, role_id: roleId },
    });

    if (role === "vendor") {
      const existing = await tx.vendors.findUnique({ where: { user_id: user.id } });
      if (!existing) {
        await tx.vendors.create({
          data: {
            user_id: user.id,
            client_name: fullName,
            business_name: `${fullName} Pvt. Ltd.`,
            phone,
            email,
            status: "active",
          },
        });
      }
    } else if (role === "rider") {
      const existing = await tx.riders.findUnique({ where: { user_id: user.id } });
      if (!existing) {
        await tx.riders.create({ data: { user_id: user.id, name: fullName, phone, status: "active" } });
      }
    } else if (role === "admin" || role === "super_admin") {
      const existing = await tx.admins.findUnique({ where: { user_id: user.id } });
      if (!existing) {
        await tx.admins.create({ data: { user_id: user.id, position: "Loadtest" } });
      }
    }
    // sales has no profile table (see seed-demo-users.ts).

    return user.id;
  });

  // Mint the session token directly instead of calling POST /auth/login -
  // that endpoint is rate-limited at 500 attempts/15min PER IP (loginLimiter
  // in auth.routes.ts), shared across every account since they all come
  // from this one seeding process. Provisioning thousands of accounts
  // through the real endpoint would take well over an hour. Mirrors the
  // exact payload/options loginUser() signs in auth.service.ts.
  const token = jwt.sign({ id: userId, roles: [role], mustChangePassword: false }, JWT_SECRET!, {
    expiresIn: "7d",
    jwtid: randomUUID(),
  });

  return { role, email, userId, token };
}

async function main() {
  const total = Object.values(COUNTS).reduce((a, b) => a + b, 0);
  console.log(`🌱 Seeding ${total} load-test accounts across 5 roles...`);

  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const roles = {
    vendor: await ensureRole("vendor", "Vendor", "Merchant access"),
    rider: await ensureRole("rider", "Rider", "Delivery operations"),
    sales: await ensureRole("sales", "Sales", "Sales team access"),
    admin: await ensureRole("admin", "Admin", "Branch management"),
    super_admin: await ensureRole("super_admin", "Super Admin", "Full system access"),
  };

  const pool: PoolEntry[] = [];

  for (const role of Object.keys(COUNTS) as Role[]) {
    const count = COUNTS[role];
    const indices = Array.from({ length: count }, (_, i) => i);
    const entries: PoolEntry[] = new Array(count);
    let done = 0;

    await runBatched(indices, CONCURRENCY, async (i) => {
      entries[i] = await createAccount(role, i, roles[role].id, passwordHash);
      done++;
      if (done % 200 === 0 || done === count) {
        process.stdout.write(`\r👤 ${role.padEnd(11)} ${done}/${count}`);
      }
    });
    console.log("");
    pool.push(...entries);
  }

  const outDir = path.join(__dirname, "..", "loadtest", "k6");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "pool.json");
  fs.writeFileSync(outPath, JSON.stringify(pool));

  console.log(`🏁 Done. ${pool.length} accounts seeded, tokens written to ${outPath}`);
  console.log(`   Password (for manual login, if ever needed): ${PASSWORD}`);
  console.log(`   Tokens are valid 7 days - rerun this script to refresh them.`);
  for (const role of Object.keys(COUNTS) as Role[]) {
    console.log(`   ${role.padEnd(11)} ${COUNTS[role]} accounts -> read-limiter ceiling ${COUNTS[role] * 120}/min`);
  }
}

main()
  .catch((e) => {
    console.error("❌ Error seeding load-test users:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
