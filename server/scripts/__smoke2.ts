// Throwaway smoke test: exercises the Rs. 1,000-now / Rs. 2,000-later flow.
// The seed data's only unsettled collection is worth Rs. 0, so the statement's
// payable is overwritten with 3000 purely as a fixture. Everything created is
// deleted at the end and the collection restored.
import prisma from "../src/lib/prisma";
import { createSettlement, payForSettlement, getSettlementDetail, attachSettlementDocuments, deleteSettlementDocument, updateSettlement, cancelSettlement, revertSettlement } from "../src/services/finance.service";

const log = (...a: any[]) => console.log(...a);

(async () => {
  const actorRow = await prisma.users.findFirst({ where: { deleted_at: null } });
  const actor = { id: actorRow!.id, roles: ["super_admin"] };
  const coll = (await prisma.cod_collections.findFirst({
    where: { payment_status: "pending", collected_at: { not: null }, vendor_id: { not: null } },
  }))!;

  const created = await createSettlement(actor, {
    payeeType: "vendor", targetId: coll.vendor_id!, codCollectionIds: [coll.id],
    settlementDate: new Date().toISOString().slice(0, 10),
  });
  await prisma.settlements.update({ where: { id: created.id }, data: { payable_amount: 3000, amount: 3000 } });
  log("statement", created.statementId, "payable set to 3000");

  const a = await payForSettlement(actor, created.id, {
    payments: [{ method: "Cash", amount: 1000 } as any], remark: "first 1000",
    paymentReceiptPaths: ["uploads/settlements/fake-a.jpg"],
  });
  log("pay 1000 ->", a.status, "paid", a.paidAmount, "remaining", a.remainingAmount, "paymentId?", Boolean(a.paymentId));
  log("  collection still pending:", (await prisma.cod_collections.findUnique({ where: { id: coll.id } }))!.payment_status);

  for (const [label, fn] of [
    ["edit while part paid", () => updateSettlement(actor, created.id, [coll.id])],
    ["cancel while part paid", () => cancelSettlement(actor, created.id, "nope")],
    ["overpay the balance", () => payForSettlement(actor, created.id, { payments: [{ method: "Cash", amount: 2500 } as any] })],
    ["zero payment", () => payForSettlement(actor, created.id, { payments: [{ method: "Cash", amount: 0 } as any] })],
  ] as const) {
    try { await fn(); log(`FAIL: ${label} was allowed`); }
    catch (e: any) { log(`${label} rejected:`, e.message); }
  }

  // Add a second receipt to the first instalment, then a statement-level one.
  await attachSettlementDocuments(actor, created.id, {
    paymentReceiptPaths: ["uploads/settlements/fake-a2.jpg"], paymentId: a.paymentId!,
  });
  const withExtra = await attachSettlementDocuments(actor, created.id, {
    taxInvoicePaths: ["uploads/settlements/fake-inv.pdf"],
  });
  log("docs after adding:", withExtra.documents.map((d) => `${d.kind}${d.paymentId ? "@pay" : "@stmt"}${d.isPdf ? "(pdf)" : ""}`).join(", "));

  const toReplace = withExtra.documents.find((d) => d.kind === "receipt")!;
  await attachSettlementDocuments(actor, created.id, {
    paymentReceiptPaths: ["uploads/settlements/fake-a-replaced.jpg"], replaceDocumentId: toReplace.id,
  });
  const afterDelete = await deleteSettlementDocument(actor, created.id, toReplace.id);
  log("after replace + delete, docs:", afterDelete.documents.length);

  const b = await payForSettlement(actor, created.id, {
    payments: [{ method: "Online", amount: 1500 }, { method: "Cash", amount: 500 }] as any, remark: "balance 2000",
  });
  log("pay 2000 ->", b.status, "paid", b.paidAmount, "remaining", b.remainingAmount);

  const d = await getSettlementDetail(actor, created.id);
  log("detail:", d.status, "paid", d.paidAmount, "remaining", d.remainingAmount);
  log("  instalments:", d.paymentRecords.map((p) => `${p.method}=${p.amount}[${p.documents.length}doc]`).join(" | "));
  log("  roll-up method:", d.paymentMethod, "| lines:", JSON.stringify(d.payments));
  log("  collection now:", (await prisma.cod_collections.findUnique({ where: { id: coll.id } }))!.payment_status);

  const rev = await revertSettlement(actor, created.id, "cleanup");
  const afterRev = await getSettlementDetail(actor, created.id);
  log("revert ->", rev.status, "paid", afterRev.paidAmount, "instalments", afterRev.paymentRecords.length, "docs", afterRev.documents.length,
    "| collection:", (await prisma.cod_collections.findUnique({ where: { id: coll.id } }))!.payment_status);

  await prisma.settlements.delete({ where: { id: created.id } });
  await prisma.cod_collections.update({ where: { id: coll.id }, data: { payment_status: "pending", remitted_amount: 0 } });
  log("cleanup: settlements =", await prisma.settlements.count(), "| pending vendor cods =",
    await prisma.cod_collections.count({ where: { payment_status: "pending", collected_at: { not: null }, vendor_id: { not: null } } }));
  await prisma.$disconnect();
})().catch(async (e) => { console.error("ERROR", e.message ?? e); await prisma.$disconnect(); process.exit(1); });
