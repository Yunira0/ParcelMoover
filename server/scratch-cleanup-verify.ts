import prisma from './src/lib/prisma';

async function main() {
  const user = await prisma.users.findUnique({ where: { email: 'scratch-verify-admin@example.com' } });
  if (!user) {
    console.log('Already cleaned up');
    return;
  }
  await prisma.admins.deleteMany({ where: { user_id: user.id } });
  await prisma.user_roles.deleteMany({ where: { user_id: user.id } });
  await prisma.users.delete({ where: { id: user.id } });
  console.log('Cleaned up scratch verify admin');
}

main().finally(() => prisma.$disconnect());
