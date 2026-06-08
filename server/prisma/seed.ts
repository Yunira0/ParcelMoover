import "dotenv/config";
import prisma  from "../src/lib/prisma";
import * as bcrypt from "bcrypt";

async function main() {
  console.log("🌱 Starting database seeding...");

  // 1. Seed Roles
  const rolesData = [
    {
      code: "super_admin",
      name: "Super Admin",
      description: "Full system access and authority over all resources",
    },
    {
      code: "admin",
      name: "Admin",
      description: "Management access over specific branches and standard operations",
    },
    {
      code: "rider",
      name: "Rider",
      description: "Delivery and pickup operations access",
    },
    {
      code: "vendor",
      name: "Vendor",
      description: "Client merchant access to create and monitor shipments",
    },
  ];

  console.log("Seeding roles...");
  const seededRoles = [];
  for (const role of rolesData) {
    const existing = await prisma.roles.findUnique({
      where: { code: role.code },
    });

    if (!existing) {
      const newRole = await prisma.roles.create({
        data: role,
      });
      console.log(`✅ Created role: ${role.code}`);
      seededRoles.push(newRole);
    } else {
      console.log(`ℹ️ Role already exists: ${role.code}`);
      seededRoles.push(existing);
    }
  }

  // 2. Seed Super Admin User
  const adminEmail = process.env.SUPERADMIN_EMAIL;
  const adminPassword = process.env.SUPERADMIN_PASSWORD;
  
  if (!adminEmail || !adminPassword) {
    throw new Error("SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD must be set in environment variables.");
  }
  
  console.log(`Checking super admin user with email: ${adminEmail}...`);
  
  let user = await prisma.users.findUnique({
    where: { email: adminEmail },
  });

  const superAdminRole = seededRoles.find((r) => r.code === "super_admin");
  if (!superAdminRole) {
    throw new Error("Super Admin role was not found or created!");
  }

  if (!user) {
    console.log("Super Admin not found. Creating...");
    
    // Hash password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(adminPassword, saltRounds);

    // Create User, Admin profile, and link User-Role in a transaction
    user = await prisma.$transaction(async (tx) => {
      // Create user
      const newUser = await tx.users.create({
        data: {
          full_name: "Super Administrator",
          email: adminEmail,
          phone: "9876543210", // Default unique phone number placeholder
          password_hash: passwordHash,
          status: "active",
        },
      });

      // Create admin profile
      await tx.admins.create({
        data: {
          user_id: newUser.id,
          position: "Chief Executive Officer",
        },
      });

      // Assign Super Admin role
      await tx.user_roles.create({
        data: {
          user_id: newUser.id,
          role_id: superAdminRole.id,
        },
      });

      return newUser;
    });

    console.log("✅ Super Admin user created and roles assigned successfully!");
    console.log(`📧 Email: ${adminEmail}`);
    console.log(`🔑 Password: ${adminPassword}`);
  } else {
    console.log(`ℹ️ Super Admin user already exists (ID: ${user.id})`);
    
    // Ensure the super admin role is assigned
    const userRoleExists = await prisma.user_roles.findUnique({
      where: {
        user_id_role_id: {
          user_id: user.id,
          role_id: superAdminRole.id,
        },
      },
    });

    if (!userRoleExists) {
      await prisma.user_roles.create({
        data: {
          user_id: user.id,
          role_id: superAdminRole.id,
        },
      });
      console.log("✅ Linked existing user to Super Admin role.");
    }
  }

  console.log("🏁 Seeding complete!");
}

main()
  .catch((e) => {
    console.error("❌ Error seeding database:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
