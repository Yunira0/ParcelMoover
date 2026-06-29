import "dotenv/config";
import prisma from "../src/lib/prisma";
import * as bcrypt from "bcrypt";

// Seeds two demo users each for: admin, rider, vendor, sales.
// All share the password below and are flagged active. Idempotent via upsert on email.
const PASSWORD = "DemoPass123!";

async function main() {
  console.log("🌱 Seeding demo users (admin / rider / vendor / sales)...");

  const passwordHash = await bcrypt.hash(PASSWORD, 12);

  // ---------------------------------------------------------------------------
  // Ensure roles exist (sales is new; the others come from the main seed).
  // ---------------------------------------------------------------------------
  const rolesData = [
    { code: "admin", name: "Admin", description: "Branch management" },
    { code: "rider", name: "Rider", description: "Delivery operations" },
    { code: "vendor", name: "Vendor", description: "Merchant access" },
    { code: "sales", name: "Sales", description: "Sales team access" },
  ];
  for (const role of rolesData) {
    await prisma.roles.upsert({
      where: { code: role.code },
      update: {},
      create: role,
    });
  }

  type DemoUser = {
    role: "admin" | "rider" | "vendor" | "sales";
    full_name: string;
    email: string;
    phone: string;
  };

  const demoUsers: DemoUser[] = [
    { role: "admin", full_name: "Demo Admin One", email: "admin1@demo.com", phone: "+9779810000001" },
    { role: "admin", full_name: "Demo Admin Two", email: "admin2@demo.com", phone: "+9779810000002" },
    { role: "rider", full_name: "Demo Rider One", email: "rider1@demo.com", phone: "+9779810000003" },
    { role: "rider", full_name: "Demo Rider Two", email: "rider2@demo.com", phone: "+9779810000004" },
    { role: "vendor", full_name: "Demo Vendor One", email: "vendor1@demo.com", phone: "+9779810000005" },
    { role: "vendor", full_name: "Demo Vendor Two", email: "vendor2@demo.com", phone: "+9779810000006" },
    { role: "sales", full_name: "Demo Sales One", email: "sales1@demo.com", phone: "+9779810000007" },
    { role: "sales", full_name: "Demo Sales Two", email: "sales2@demo.com", phone: "+9779810000008" },
  ];

  for (const du of demoUsers) {
    const role = (await prisma.roles.findUnique({ where: { code: du.role } }))!;

    await prisma.$transaction(async (tx) => {
      const user = await tx.users.upsert({
        where: { email: du.email },
        update: {},
        create: {
          full_name: du.full_name,
          email: du.email,
          phone: du.phone,
          password_hash: passwordHash,
          status: "active",
        },
      });

      await tx.user_roles.upsert({
        where: { user_id_role_id: { user_id: user.id, role_id: role.id } },
        update: {},
        create: { user_id: user.id, role_id: role.id },
      });

      // Create the role-specific profile row (sales has no profile table).
      if (du.role === "admin") {
        const existing = await tx.admins.findUnique({ where: { user_id: user.id } });
        if (!existing) {
          await tx.admins.create({
            data: { user_id: user.id, position: "Demo Admin" },
          });
        }
      } else if (du.role === "rider") {
        const existing = await tx.riders.findUnique({ where: { user_id: user.id } });
        if (!existing) {
          await tx.riders.create({
            data: { user_id: user.id, name: du.full_name, phone: du.phone, status: "active" },
          });
        }
      } else if (du.role === "vendor") {
        const existing = await tx.vendors.findUnique({ where: { user_id: user.id } });
        if (!existing) {
          await tx.vendors.create({
            data: {
              user_id: user.id,
              client_name: du.full_name,
              business_name: `${du.full_name} Pvt. Ltd.`,
              phone: du.phone,
              email: du.email,
              status: "active",
            },
          });
        }
      }
    });

    console.log(`👤 ${du.role.padEnd(7)} ${du.email}`);
  }

  // ---------------------------------------------------------------------------
  // Assign clients (vendors) to sales owners so each sales account has scoped
  // data to view. sales1 owns the two main-seed vendors + demo vendor1; sales2
  // owns demo vendor2.
  // ---------------------------------------------------------------------------
  const sales1 = await prisma.users.findUnique({ where: { email: "sales1@demo.com" } });
  const sales2 = await prisma.users.findUnique({ where: { email: "sales2@demo.com" } });

  const links: Array<{ vendorEmail: string; salesUserId: string }> = [];
  if (sales1) {
    links.push({ vendorEmail: "vendor1@demo.com", salesUserId: sales1.id });
    links.push({ vendorEmail: "contact@everesttraders.com", salesUserId: sales1.id });
    links.push({ vendorEmail: "info@ktmelectronics.com", salesUserId: sales1.id });
  }
  if (sales2) {
    links.push({ vendorEmail: "vendor2@demo.com", salesUserId: sales2.id });
  }

  for (const link of links) {
    const result = await prisma.vendors.updateMany({
      where: { email: link.vendorEmail },
      data: { sales_user_id: link.salesUserId },
    });
    if (result.count) console.log(`🔗 Client ${link.vendorEmail} → sales ${link.salesUserId.slice(0, 8)}`);
  }

  console.log(`🏁 Done. Login password for all demo users: ${PASSWORD}`);
}

main()
  .catch((e) => {
    console.error("❌ Error seeding demo users:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
