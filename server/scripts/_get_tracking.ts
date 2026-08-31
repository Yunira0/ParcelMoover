import prisma from "../src/lib/prisma";
async function main() {
  const p = await prisma.parcels.findUnique({ where: { id: "4c01148f-b9ce-4095-b544-7907a6578aaa" }, select: { tracking_id: true } });
  console.log(p?.tracking_id);
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)});
