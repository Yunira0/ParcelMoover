import prisma from "../src/lib/prisma";
async function main() {
  const rows = await prisma.parcel_status_history.findMany({
    where: { changed_by: "5ef45527-07a5-4b00-b910-16eee75d9131" },
    orderBy: { created_at: "desc" },
    take: 5,
  });
  console.log(rows);
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)});
