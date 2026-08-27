import prisma from "../src/lib/prisma";

async function main() {
  const rows = await prisma.parcel_status_history.findMany({
    where: { changed_by: { not: null } },
    orderBy: { created_at: "desc" },
    take: 10,
    include: { users: { include: { user_roles: { include: { roles: true } } } } },
  });
  for (const r of rows) {
    console.log({
      id: r.id,
      old: r.old_status,
      new: r.new_status,
      changed_by: r.changed_by,
      userName: r.users?.full_name,
      userRoles: r.users?.user_roles.map(ur => ur.roles.code),
      created_at: r.created_at,
    });
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
