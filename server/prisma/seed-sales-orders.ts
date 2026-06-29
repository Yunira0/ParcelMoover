import "dotenv/config";
import prisma from "../src/lib/prisma";
import { parcel_status } from "../src/generated/prisma/enums";

// Creates 4 demo orders (parcels) for one client of each sales user, so each
// sales account has orders to see in its scoped views. Idempotent via upsert
// on tracking_id.

const STATUSES: parcel_status[] = [
  "pickup_ordered",
  "sent_for_delivery",
  "delivered",
  "hold",
];

async function ensureParty(name: string, phone: string) {
  const existing = await prisma.parties.findFirst({ where: { phone } });
  if (existing) return existing;
  return prisma.parties.create({ data: { name, phone, address: `${name} Address` } });
}

async function ordersForSales(email: string, prefix: string) {
  const user = await prisma.users.findUnique({ where: { email } });
  if (!user) {
    console.log(`⚠️  ${email} not found — skipping`);
    return;
  }

  const vendor = await prisma.vendors.findFirst({
    where: { sales_user_id: user.id, deleted_at: null },
    orderBy: { created_at: "asc" },
  });
  if (!vendor) {
    console.log(`⚠️  ${email} owns no clients — skipping`);
    return;
  }

  const sender = await ensureParty(`${prefix} Sender`, `+97798${prefix}000001`);
  const receiver = await ensureParty(`${prefix} Receiver`, `+97798${prefix}000002`);

  for (let i = 1; i <= 4; i++) {
    const trackingId = `${prefix}-DEMO-${i.toString().padStart(3, "0")}`;
    const status = STATUSES[(i - 1) % STATUSES.length]!;
    await prisma.parcels.upsert({
      where: { tracking_id: trackingId },
      update: {},
      create: {
        tracking_id: trackingId,
        vendor_id: vendor.id,
        sender_id: sender.id,
        receiver_id: receiver.id,
        order_type: "delivery",
        service_type: "dtd",
        status,
        pieces: 1,
        weight_kg: 1.0,
        cod_amount: 1000 * i,
        delivery_charge: 100,
        created_by: user.id,
        ...(status === "delivered" ? { delivered_at: new Date() } : {}),
      },
    });
    console.log(`📦 ${trackingId} → ${vendor.client_name} [${status}]`);
  }
}

async function main() {
  console.log("🌱 Seeding 4 orders for each sales user's client...");
  await ordersForSales("sales1@demo.com", "SLS1");
  await ordersForSales("sales2@demo.com", "SLS2");
  console.log("🏁 Done.");
}

main()
  .catch((e) => {
    console.error("❌ Error seeding sales orders:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
