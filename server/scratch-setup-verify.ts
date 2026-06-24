import prisma from './src/lib/prisma';
import bcrypt from 'bcrypt';

async function main() {
  const email = 'scratch-verify-admin@example.com';
  const password = 'Scratch123!';
  const passwordHash = await bcrypt.hash(password, 10);

  let role = await prisma.roles.findUnique({ where: { code: 'super_admin' } });
  if (!role) {
    role = await prisma.roles.create({
      data: { code: 'super_admin', name: 'Super Admin' },
    });
  }

  const user = await prisma.users.create({
    data: {
      full_name: 'Scratch Verify Admin',
      email,
      password_hash: passwordHash,
      status: 'active',
    },
  });

  await prisma.user_roles.create({
    data: { user_id: user.id, role_id: role.id },
  });

  await prisma.admins.create({
    data: { user_id: user.id },
  });

  console.log(JSON.stringify({ email, password, userId: user.id }));
}

main().finally(() => prisma.$disconnect());
