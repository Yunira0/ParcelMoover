import "dotenv/config";
import prisma from "../src/lib/prisma";
import { Prisma } from "../src/generated/prisma/client";
import * as bcrypt from "bcrypt";
const prefixMap: Record<string, string> = {
  loc: "11111111",
  usr: "22222222",
  adm: "33333333",
  rdr: "44444444",
  vnd: "55555555",
  pty: "66666666",
  prl: "77777777",
  psh: "88888888",
  prk: "99999999",
  pkt: "aaaaaaaa",
  cod: "bbbbbbbb",
  dsp: "cccccccc",
  exc: "dddddddd",
  stl: "eeeeeeee",
  tkt: "ffffffff",
  adt: "12345678",
  not: "87654321",
};
// Helper to generate UUID-like strings deterministically for demo
const demoUuid = (prefix: string, num: number) => {
  const hexPrefix = prefixMap[prefix] || "00000000";
  return `${hexPrefix}-0000-0000-0000-${num.toString().padStart(12, "0")}`;
};
async function main() {
  // This seed hardcodes "DemoPass123!" for every account it creates,
  // including the super admin — a known password must never exist in a
  // real deployment. Use prisma/create-superadmin.ts for a real first admin.
  if (process.env.NODE_ENV === "production") {
    console.error("Refusing to run the demo seed with NODE_ENV=production.");
    process.exit(1);
  }
  console.log("🌱 Starting comprehensive database seeding...");
  // =========================================================================
  // 1. Seed Roles
  // =========================================================================
  const rolesData = [
    { code: "super_admin", name: "Super Admin", description: "Full system access" },
    { code: "admin", name: "Admin", description: "Branch management" },
    { code: "rider", name: "Rider", description: "Delivery operations" },
    { code: "vendor", name: "Vendor", description: "Merchant access" },
  ];
  for (const role of rolesData) {
    await prisma.roles.upsert({
      where: { code: role.code },
      update: {},
      create: role,
    });
    console.log(`✅ Role: ${role.code}`);
  }
  const superAdminRole = (await prisma.roles.findUnique({ where: { code: "super_admin" } }))!;
  const adminRole = (await prisma.roles.findUnique({ where: { code: "admin" } }))!;
  const riderRole = (await prisma.roles.findUnique({ where: { code: "rider" } }))!;
  const vendorRole = (await prisma.roles.findUnique({ where: { code: "vendor" } }))!;
  // =========================================================================
  // 2. Seed Locations (hubs and branches)
  // =========================================================================
  const locationsData = [
    {
      id: demoUuid("loc", 1),
      name: "Kathmandu Central Hub",
      code: "KTM-HUB",
      province: "Bagmati",
      district: "Kathmandu",
      city: "Kathmandu",
      address_line: "New Road, Kathmandu",
      latitude: 27.7172,
      longitude: 85.324,
      is_hub: false,
      is_active: true,
    },
    {
      id: demoUuid("loc", 2),
      name: "Pokhara Branch",
      code: "PKR-01",
      province: "Gandaki",
      district: "Kaski",
      city: "Pokhara",
      address_line: "Lakeside, Pokhara",
      latitude: 28.2096,
      longitude: 83.9856,
      is_hub: false,
      is_active: true,
    },
    {
      id: demoUuid("loc", 3),
      name: "Biratnagar Branch",
      code: "BRT-01",
      province: "Koshi",
      district: "Morang",
      city: "Biratnagar",
      address_line: "East-West Highway",
      latitude: 26.4525,
      longitude: 87.2728,
      is_hub: false,
      is_active: true,
    },
    {
      id: demoUuid("loc", 4),
      name: "Lalitpur Sub-hub",
      code: "LAL-01",
      province: "Bagmati",
      district: "Lalitpur",
      city: "Lalitpur",
      address_line: "Pulchowk, Lalitpur",
      latitude: 27.6766,
      longitude: 85.3142,
      is_hub: false,
      is_active: true,
      parent_id: demoUuid("loc", 1),
    },
    {
      id: demoUuid("loc", 5),
      name: "Bhaktapur Branch",
      code: "BKT-01",
      province: "Bagmati",
      district: "Bhaktapur",
      city: "Bhaktapur",
      address_line: "Durbar Square",
      latitude: 27.671,
      longitude: 85.4298,
      is_hub: false,
      is_active: true,
      parent_id: demoUuid("loc", 1),
    },
    {
      id: demoUuid("loc", 6),
      name: "Imadol",
      code: "IMADOL",
      province: "Bagmati",
      district: "Lalitpur",
      city: "Lalitpur",
      address_line: "Imadol, Lalitpur",
      latitude: 27.6606,
      longitude: 85.3413,
      is_hub: true,
      is_active: true,
    },
  ];
  for (const loc of locationsData) {
    await prisma.locations.upsert({
      where: { id: loc.id },
      update: {},
      create: loc,
    });
    console.log(`📍 Location: ${loc.name}`);
  }
  // =========================================================================
  // 3. Seed Users (Super Admin, Admins, Riders, Vendor Users)
  // =========================================================================
  const passwordHash = await bcrypt.hash("DemoPass123!", 10);
  const usersData = [
    {
      id: demoUuid("usr", 1),
      full_name: "Super Administrator",
      email: process.env.SUPERADMIN_EMAIL || "admin@parcelmoover.com",
      phone: "+9779800000001",
      status: "active" as const,
      password_hash: passwordHash,
    },
    {
      id: demoUuid("usr", 2),
      full_name: "Ram Shrestha",
      email: "ram.admin@parcelmoover.com",
      phone: "+9779800000002",
      status: "active" as const,
      password_hash: passwordHash,
    },
    {
      id: demoUuid("usr", 3),
      full_name: "Sita Gurung",
      email: "sita.admin@parcelmoover.com",
      phone: "+9779800000003",
      status: "active" as const,
      password_hash: passwordHash,
    },
    {
      id: demoUuid("usr", 4),
      full_name: "Hari Singh",
      email: "hari.rider@parcelmoover.com",
      phone: "+9779800000004",
      status: "active" as const,
      password_hash: passwordHash,
    },
    {
      id: demoUuid("usr", 5),
      full_name: "Gopal Yadav",
      email: "gopal.rider@parcelmoover.com",
      phone: "+9779800000005",
      status: "active" as const,
      password_hash: passwordHash,
    },
    {
      id: demoUuid("usr", 6),
      full_name: "Sunita Devi",
      email: "sunita.rider@parcelmoover.com",
      phone: "+9779800000006",
      status: "active" as const,
      password_hash: passwordHash,
    },
    {
      id: demoUuid("usr", 7),
      full_name: "Everest Traders",
      email: "contact@everesttraders.com",
      phone: "+9779800000007",
      status: "active" as const,
      password_hash: passwordHash,
    },
    {
      id: demoUuid("usr", 8),
      full_name: "KTM Electronics",
      email: "info@ktmelectronics.com",
      phone: "+9779800000008",
      status: "active" as const,
      password_hash: passwordHash,
    },
  ];
  for (const user of usersData) {
    await prisma.users.upsert({
      where: { id: user.id },
      update: {},
      create: user,
    });
    console.log(`👤 User: ${user.full_name}`);
  }
  // =========================================================================
  // 4. Seed Admins
  // =========================================================================
  const adminsData = [
    {
      id: demoUuid("adm", 1),
      user_id: usersData[0]!.id,
      location_id: demoUuid("loc", 6), // Imadol hub
      position: "Chief Executive Officer",
      joined_at: new Date("2023-01-15"),
    },
    {
      id: demoUuid("adm", 2),
      user_id: usersData[1]!.id,
      location_id: demoUuid("loc", 6), // Imadol hub
      position: "Branch Manager",
      joined_at: new Date("2023-03-20"),
    },
    {
      id: demoUuid("adm", 3),
      user_id: usersData[2]!.id,
      location_id: demoUuid("loc", 6), // Imadol hub
      position: "Operations Head",
      joined_at: new Date("2023-06-10"),
    },
  ];
  for (const admin of adminsData) {
    await prisma.admins.upsert({
      where: { id: admin.id },
      update: {},
      create: admin,
    });
    console.log(`🛡️ Admin: ${admin.position}`);
  }
  // =========================================================================
  // 5. Seed User Roles
  // =========================================================================
  const userRolesData = [
    { user_id: usersData[0]!.id, role_id: superAdminRole.id },
    { user_id: usersData[1]!.id, role_id: adminRole.id },
    { user_id: usersData[2]!.id, role_id: adminRole.id },
    { user_id: usersData[3]!.id, role_id: riderRole.id },
    { user_id: usersData[4]!.id, role_id: riderRole.id },
    { user_id: usersData[5]!.id, role_id: riderRole.id },
    { user_id: usersData[6]!.id, role_id: vendorRole.id },
    { user_id: usersData[7]!.id, role_id: vendorRole.id },
  ];
  for (const ur of userRolesData) {
    await prisma.user_roles.upsert({
      where: { user_id_role_id: { user_id: ur.user_id, role_id: ur.role_id } },
      update: {},
      create: ur,
    });
    console.log(`🔗 Role assigned`);
  }
  // =========================================================================
  // 6. Seed Riders
  // =========================================================================
  const ridersData = [
    {
      id: demoUuid("rdr", 1),
      user_id: usersData[3]!.id,
      name: "Hari Singh",
      phone: usersData[3]!.phone!,
      location_id: demoUuid("loc", 1),
      status: "active" as const,
      joined_at: new Date("2023-02-01"),
    },
    {
      id: demoUuid("rdr", 2),
      user_id: usersData[4]!.id,
      name: "Gopal Yadav",
      phone: usersData[4]!.phone!,
      location_id: demoUuid("loc", 2),
      status: "active" as const,
      joined_at: new Date("2023-07-15"),
    },
    {
      id: demoUuid("rdr", 3),
      user_id: usersData[5]!.id,
      name: "Sunita Devi",
      phone: usersData[5]!.phone!,
      location_id: demoUuid("loc", 1),
      status: "active" as const,
      joined_at: new Date("2024-01-10"),
    },
  ];
  for (const rider of ridersData) {
    await prisma.riders.upsert({
      where: { id: rider.id },
      update: {},
      create: rider,
    });
    console.log(`🚚 Rider: ${rider.name}`);
  }
  // =========================================================================
  // 7. Seed Vendors
  // =========================================================================
  const vendorsData = [
    {
      id: demoUuid("vnd", 1),
      user_id: usersData[6]!.id,
      client_name: "Everest Traders",
      business_name: "Everest Trading Pvt. Ltd.",
      phone: usersData[6]!.phone!,
      email: usersData[6]!.email,
      location_id: demoUuid("loc", 1),
      address: "New Baneshwor, Kathmandu",
      status: "active" as const,
      joined_at: new Date("2023-04-01"),
    },
    {
      id: demoUuid("vnd", 2),
      user_id: usersData[7]!.id,
      client_name: "KTM Electronics",
      business_name: "KTM Electronics & Gadgets",
      phone: usersData[7]!.phone!,
      email: usersData[7]!.email,
      location_id: demoUuid("loc", 2),
      address: "Chipledhunga, Pokhara",
      status: "active" as const,
      joined_at: new Date("2023-09-20"),
    },
  ];
  for (const vendor of vendorsData) {
    await prisma.vendors.upsert({
      where: { id: vendor.id },
      update: {},
      create: vendor,
    });
    console.log(`🏢 Vendor: ${vendor.client_name}`);
  }
  // =========================================================================
  // 8. Seed Parties (Senders & Receivers)
  // =========================================================================
  const partiesData = [
    {
      id: demoUuid("pty", 1),
      name: "Ramesh Karki",
      phone: "+9779800000011",
      email: "ramesh@email.com",
      address: "Baneshwor, Kathmandu",
      location_id: demoUuid("loc", 1),
    },
    {
      id: demoUuid("pty", 2),
      name: "Anita Sharma",
      phone: "+9779800000012",
      email: "anita@email.com",
      address: "Lakeside, Pokhara",
      location_id: demoUuid("loc", 2),
    },
    {
      id: demoUuid("pty", 3),
      name: "Dipak Thapa",
      phone: "+9779800000013",
      address: "Biratnagar Main Road",
      location_id: demoUuid("loc", 3),
    },
    {
      id: demoUuid("pty", 4),
      name: "Maya Rai",
      phone: "+9779800000014",
      email: "maya@email.com",
      address: "Pulchowk, Lalitpur",
      location_id: demoUuid("loc", 4),
    },
    {
      id: demoUuid("pty", 5),
      name: "Bijaya Tamang",
      phone: "+9779800000015",
      address: "Bhaktapur Durbar Square",
      location_id: demoUuid("loc", 5),
    },
  ];
  for (const party of partiesData) {
    await prisma.parties.upsert({
      where: { id: party.id },
      update: {},
      create: party,
    });
    console.log(`👥 Party: ${party.name}`);
  }
  // =========================================================================
  // 9. Seed Parcels
  // =========================================================================
  const today = new Date();
  const parcelsData = [
    // Parcel 1: Delivery from KTM to PKR (picked up, in transit)
    {
      id: demoUuid("prl", 1),
      tracking_id: "PMV-KTM-2024-001",
      vendor_id: vendorsData[0]!.id,
      sender_id: partiesData[0]!.id,
      receiver_id: partiesData[1]!.id,
      pickup_rider_id: ridersData[0]!.id,
      delivery_rider_id: ridersData[1]!.id,
      origin_location_id: demoUuid("loc", 1),
      current_location_id: demoUuid("loc", 2),
      destination_location_id: demoUuid("loc", 2),
      order_type: "delivery" as const,
      service_type: "home_delivery" as const,
      status: "arrived_at_branch" as const,
      pieces: 1,
      weight_kg: 0.5,
      cod_amount: 0,
      delivery_charge: 150,
      attempt_count: 0,
      created_by: usersData[0]!.id,
      picked_up_at: new Date(today.getTime() - 86400000 * 2),
      delivered_at: null,
    },
    // Parcel 2: COD parcel, sent for delivery
    {
      id: demoUuid("prl", 2),
      tracking_id: "PMV-KTM-2024-002",
      vendor_id: vendorsData[0]!.id,
      sender_id: partiesData[0]!.id,
      receiver_id: partiesData[2]!.id,
      pickup_rider_id: ridersData[0]!.id,
      delivery_rider_id: ridersData[2]!.id,
      origin_location_id: demoUuid("loc", 1),
      current_location_id: demoUuid("loc", 1),
      destination_location_id: demoUuid("loc", 3),
      order_type: "delivery" as const,
      service_type: "home_delivery" as const,
      status: "sent_for_delivery" as const,
      pieces: 2,
      weight_kg: 2.0,
      cod_amount: 5000,
      delivery_charge: 200,
      attempt_count: 0,
      created_by: usersData[1]!.id,
      picked_up_at: new Date(today.getTime() - 86400000),
      delivered_at: null,
    },
    // Parcel 3: Already delivered COD
    {
      id: demoUuid("prl", 3),
      tracking_id: "PMV-PKR-2024-003",
      vendor_id: vendorsData[1]!.id,
      sender_id: partiesData[1]!.id,
      receiver_id: partiesData[0]!.id,
      pickup_rider_id: ridersData[1]!.id,
      delivery_rider_id: ridersData[0]!.id,
      origin_location_id: demoUuid("loc", 2),
      current_location_id: demoUuid("loc", 1),
      destination_location_id: demoUuid("loc", 1),
      order_type: "exchange" as const,
      service_type: "home_delivery" as const,
      status: "delivered" as const,
      pieces: 1,
      weight_kg: 1.2,
      cod_amount: 3500,
      delivery_charge: 180,
      attempt_count: 0,
      created_by: usersData[1]!.id,
      picked_up_at: new Date(today.getTime() - 86400000 * 5),
      delivered_at: new Date(today.getTime() - 86400000),
    },
    // Parcel 4: Failed delivery
    {
      id: demoUuid("prl", 4),
      tracking_id: "PMV-KTM-2024-004",
      vendor_id: vendorsData[0]!.id,
      sender_id: partiesData[3]!.id,
      receiver_id: partiesData[4]!.id,
      pickup_rider_id: ridersData[0]!.id,
      delivery_rider_id: ridersData[2]!.id,
      origin_location_id: demoUuid("loc", 4),
      current_location_id: demoUuid("loc", 4),
      destination_location_id: demoUuid("loc", 5),
      order_type: "return" as const,
      service_type: "home_delivery" as const,
      status: "failed_delivery" as const,
      pieces: 1,
      weight_kg: 0.8,
      cod_amount: 0,
      delivery_charge: 120,
      attempt_count: 2,
      created_by: usersData[0]!.id,
      picked_up_at: new Date(today.getTime() - 86400000 * 3),
      delivered_at: null,
    },
    // Parcel 5: On hold at hub
    {
      id: demoUuid("prl", 5),
      tracking_id: "PMV-BRT-2024-005",
      vendor_id: vendorsData[1]!.id,
      sender_id: partiesData[2]!.id,
      receiver_id: partiesData[3]!.id,
      pickup_rider_id: ridersData[1]!.id,
      delivery_rider_id: null,
      origin_location_id: demoUuid("loc", 3),
      current_location_id: demoUuid("loc", 1),
      destination_location_id: demoUuid("loc", 4),
      order_type: "delivery" as const,
      service_type: "branch_delivery" as const,
      status: "hold" as const,
      pieces: 5,
      weight_kg: 15.5,
      cod_amount: 25000,
      delivery_charge: 500,
      attempt_count: 0,
      created_by: usersData[2]!.id,
      picked_up_at: new Date(today.getTime() - 86400000 * 7),
      delivered_at: null,
    },
  ];
  for (const parcel of parcelsData) {
    await prisma.parcels.upsert({
      where: { id: parcel.id },
      update: {},
      create: parcel,
    });
    console.log(`📦 Parcel: ${parcel.tracking_id}`);
  }
  // =========================================================================
  // 10. Seed Parcel Status History
  // =========================================================================
  const statusHistoryData = [
    {
      id: demoUuid("psh", 1),
      parcel_id: parcelsData[0]!.id,
      old_status: null,
      new_status: "pickup_ordered",
      location_id: demoUuid("loc", 1),
      changed_by: usersData[0]!.id,
    },
    {
      id: demoUuid("psh", 2),
      parcel_id: parcelsData[0]!.id,
      old_status: "pickup_ordered",
      new_status: "rider_assigned",
      location_id: demoUuid("loc", 1),
      changed_by: usersData[1]!.id,
    },
    {
      id: demoUuid("psh", 3),
      parcel_id: parcelsData[0]!.id,
      old_status: "rider_assigned",
      new_status: "picked_up",
      location_id: demoUuid("loc", 1),
      changed_by: usersData[0]!.id,
    },
    {
      id: demoUuid("psh", 4),
      parcel_id: parcelsData[0]!.id,
      old_status: "picked_up",
      new_status: "dispatched",
      location_id: demoUuid("loc", 1),
      changed_by: usersData[1]!.id,
    },
    {
      id: demoUuid("psh", 5),
      parcel_id: parcelsData[0]!.id,
      old_status: "dispatched",
      new_status: "arrived_at_branch",
      location_id: demoUuid("loc", 2),
      changed_by: usersData[1]!.id,
    },
    {
      id: demoUuid("psh", 6),
      parcel_id: parcelsData[1]!.id,
      old_status: null,
      new_status: "pickup_ordered",
      location_id: demoUuid("loc", 1),
      changed_by: usersData[0]!.id,
    },
    {
      id: demoUuid("psh", 7),
      parcel_id: parcelsData[1]!.id,
      old_status: "pickup_ordered",
      new_status: "picked_up",
      location_id: demoUuid("loc", 1),
      changed_by: usersData[0]!.id,
    },
    {
      id: demoUuid("psh", 8),
      parcel_id: parcelsData[1]!.id,
      old_status: "picked_up",
      new_status: "sent_for_delivery",
      location_id: demoUuid("loc", 1),
      changed_by: usersData[1]!.id,
    },
    {
      id: demoUuid("psh", 9),
      parcel_id: parcelsData[2]!.id,
      old_status: null,
      new_status: "pickup_ordered",
      location_id: demoUuid("loc", 2),
      changed_by: usersData[1]!.id,
    },
    {
      id: demoUuid("psh", 10),
      parcel_id: parcelsData[2]!.id,
      old_status: "pickup_ordered",
      new_status: "delivered",
      location_id: demoUuid("loc", 1),
      changed_by: usersData[0]!.id,
    },
    {
      id: demoUuid("psh", 11),
      parcel_id: parcelsData[3]!.id,
      old_status: null,
      new_status: "pickup_ordered",
      location_id: demoUuid("loc", 4),
      changed_by: usersData[0]!.id,
    },
    {
      id: demoUuid("psh", 12),
      parcel_id: parcelsData[3]!.id,
      old_status: "pickup_ordered",
      new_status: "picked_up",
      location_id: demoUuid("loc", 4),
      changed_by: usersData[0]!.id,
    },
    {
      id: demoUuid("psh", 13),
      parcel_id: parcelsData[3]!.id,
      old_status: "picked_up",
      new_status: "failed_delivery",
      location_id: demoUuid("loc", 5),
      changed_by: usersData[0]!.id,
    },
    {
      id: demoUuid("psh", 14),
      parcel_id: parcelsData[4]!.id,
      old_status: null,
      new_status: "pickup_ordered",
      location_id: demoUuid("loc", 3),
      changed_by: usersData[2]!.id,
    },
    {
      id: demoUuid("psh", 15),
      parcel_id: parcelsData[4]!.id,
      old_status: "pickup_ordered",
      new_status: "picked_up",
      location_id: demoUuid("loc", 3),
      changed_by: usersData[2]!.id,
    },
    {
      id: demoUuid("psh", 16),
      parcel_id: parcelsData[4]!.id,
      old_status: "picked_up",
      new_status: "hold",
      location_id: demoUuid("loc", 1),
      changed_by: usersData[1]!.id,
    },
  ];
  for (const sh of statusHistoryData) {
    await prisma.parcel_status_history.upsert({
      where: { id: sh.id },
      update: {},
      create: sh as any,
    });
    console.log(`🔄 Status history: ${sh.new_status}`);
  }
  // =========================================================================
  // 11. Seed Parcel Remarks
  // =========================================================================
  const remarksData = [
    {
      id: demoUuid("prk", 1),
      parcel_id: parcelsData[0]!.id,
      user_id: usersData[0]!.id,
      location_id: demoUuid("loc", 1),
      remark: "Handle with care - fragile electronics",
    },
    {
      id: demoUuid("prk", 2),
      parcel_id: parcelsData[1]!.id,
      user_id: usersData[1]!.id,
      location_id: demoUuid("loc", 1),
      remark: "COD amount confirmed with sender",
    },
    {
      id: demoUuid("prk", 3),
      parcel_id: parcelsData[3]!.id,
      user_id: usersData[0]!.id,
      location_id: demoUuid("loc", 5),
      remark: "Receiver not available - door locked",
    },
    {
      id: demoUuid("prk", 4),
      parcel_id: parcelsData[4]!.id,
      user_id: usersData[1]!.id,
      location_id: demoUuid("loc", 1),
      remark: "On hold - awaiting custom clearance documents",
    },
  ];
  for (const remark of remarksData) {
    await prisma.parcel_remarks.upsert({
      where: { id: remark.id },
      update: {},
      create: remark,
    });
    console.log(`💬 Remark added for parcel ${remark.parcel_id.slice(-4)}`);
  }
  // =========================================================================
  // 12. Seed Pickup Tasks
  // =========================================================================
  const pickupTasksData = [
    {
      id: demoUuid("pkt", 1),
      parcel_id: parcelsData[0]!.id,
      rider_id: ridersData[0]!.id,
      pickup_address: "Baneshwor, Kathmandu",
      scheduled_at: new Date(today.getTime() - 86400000 * 3),
      completed_at: new Date(today.getTime() - 86400000 * 2),
      status: "picked_up" as const,
    },
    {
      id: demoUuid("pkt", 2),
      parcel_id: parcelsData[1]!.id,
      rider_id: ridersData[0]!.id,
      pickup_address: "Baneshwor, Kathmandu",
      scheduled_at: new Date(today.getTime() - 86400000 * 2),
      completed_at: new Date(today.getTime() - 86400000),
      status: "picked_up" as const,
    },
    {
      id: demoUuid("pkt", 3),
      parcel_id: parcelsData[4]!.id,
      rider_id: ridersData[1]!.id,
      pickup_address: "Biratnagar Main Road",
      scheduled_at: new Date(today.getTime() - 86400000 * 7),
      completed_at: new Date(today.getTime() - 86400000 * 6),
      status: "picked_up" as const,
    },
  ];
  for (const task of pickupTasksData) {
    await prisma.pickup_tasks.upsert({
      where: { id: task.id },
      update: {},
      create: task,
    });
    console.log(`📋 Pickup task: ${task.parcel_id.slice(-4)}`);
  }
  // =========================================================================
  // 13. Seed COD Collections
  // =========================================================================
  const codCollectionsData = [
    {
      id: demoUuid("cod", 1),
      parcel_id: parcelsData[1]!.id,
      vendor_id: vendorsData[0]!.id,
      rider_id: ridersData[2]!.id,
      cod_amount: 5000,
      collected_amount: 0,
      remitted_amount: 0,
      payment_status: "pending" as const,
    },
    {
      id: demoUuid("cod", 2),
      parcel_id: parcelsData[2]!.id,
      vendor_id: vendorsData[1]!.id,
      rider_id: ridersData[0]!.id,
      cod_amount: 3500,
      collected_amount: 3500,
      remitted_amount: 2800,
      payment_status: "pending" as const,
      collected_at: new Date(today.getTime() - 86400000),
    },
    {
      id: demoUuid("cod", 3),
      parcel_id: parcelsData[4]!.id,
      vendor_id: vendorsData[1]!.id,
      rider_id: null,
      cod_amount: 25000,
      collected_amount: 0,
      remitted_amount: 0,
      payment_status: "pending" as const,
    },
  ];
  for (const cod of codCollectionsData) {
    await prisma.cod_collections.upsert({
      where: { id: cod.id },
      update: {},
      create: cod,
    });
    console.log(`💰 COD: ${cod.cod_amount} for ${cod.parcel_id.slice(-4)}`);
  }
  // =========================================================================
  // 14. Seed Dispatches
  // =========================================================================
  const dispatchesData = [
    {
      id: demoUuid("dsp", 1),
      dispatch_no: "DSP-KTM-PKR-2024-001",
      from_location_id: demoUuid("loc", 1),
      to_location_id: demoUuid("loc", 2),
      delivery_rider_id: ridersData[1]!.id,
      dispatched_by: usersData[1]!.id,
      dispatched_at: new Date(today.getTime() - 86400000 * 2),
      arrived_at: new Date(today.getTime() - 86400000),
    },
    {
      id: demoUuid("dsp", 2),
      dispatch_no: "DSP-KTM-BRT-2024-002",
      from_location_id: demoUuid("loc", 1),
      to_location_id: demoUuid("loc", 3),
      delivery_rider_id: ridersData[2]!.id,
      dispatched_by: usersData[0]!.id,
      dispatched_at: new Date(today.getTime() - 86400000 * 4),
      arrived_at: null,
    },
  ];
  for (const dispatch of dispatchesData) {
    await prisma.dispatches.upsert({
      where: { id: dispatch.id },
      update: {},
      create: dispatch,
    });
    console.log(`🚛 Dispatch: ${dispatch.dispatch_no}`);
  }
  // =========================================================================
  // 15. Seed Dispatch Parcels (junction)
  // =========================================================================
  await prisma.dispatch_parcels.upsert({
    where: {
      dispatch_id_parcel_id: {
        dispatch_id: dispatchesData[0]!.id,
        parcel_id: parcelsData[0]!.id,
      },
    },
    update: {},
    create: {
      dispatch_id: dispatchesData[0]!.id,
      parcel_id: parcelsData[0]!.id,
    },
  });
  await prisma.dispatch_parcels.upsert({
    where: {
      dispatch_id_parcel_id: {
        dispatch_id: dispatchesData[1]!.id,
        parcel_id: parcelsData[4]!.id,
      },
    },
    update: {},
    create: {
      dispatch_id: dispatchesData[1]!.id,
      parcel_id: parcelsData[4]!.id,
    },
  });
  console.log("🔗 Dispatch-Parcel links created");
  // =========================================================================
  // 16. Seed Parcel Exceptions
  // =========================================================================
  const exceptionsData = [
    {
      id: demoUuid("exc", 1),
      parcel_id: parcelsData[3]!.id,
      exception_type: "delivery_failed",
      previous_status: "sent_for_delivery" as const,
      reason: "Receiver not available after 2 attempts",
      age_days: 3,
      package_condition: "good",
      reported_by: usersData[0]!.id,
      resolved_by: null,
      reported_at: new Date(today.getTime() - 86400000 * 3),
      resolved_at: null,
      status: "open" as const,
    },
    {
      id: demoUuid("exc", 2),
      parcel_id: parcelsData[4]!.id,
      exception_type: "customs_hold",
      previous_status: "arrived_at_branch" as const,
      reason: "Awaiting import documentation",
      age_days: 7,
      package_condition: "excellent",
      reported_by: usersData[2]!.id,
      resolved_by: null,
      reported_at: new Date(today.getTime() - 86400000 * 7),
      resolved_at: null,
      status: "open" as const,
    },
  ];
  for (const ex of exceptionsData) {
    await prisma.parcel_exceptions.upsert({
      where: { id: ex.id },
      update: {},
      create: ex,
    });
    console.log(`⚠️ Exception: ${ex.exception_type}`);
  }
  // =========================================================================
  // 17. Seed Settlements
  // =========================================================================
  const settlementsData = [
    {
      id: demoUuid("stl", 1),
      statement_id: "STL-2024-001",
      payee_type: "vendor",
      rider_id: null,
      vendor_id: vendorsData[0]!.id,
      amount: 5000,
      payable_amount: 4700,
      settlement_date: new Date("2024-06-15"),
      status: "pending" as const,
      remark: "Weekly COD settlement",
      approved_by: null,
      settled_by: null,
    },
    {
      id: demoUuid("stl", 2),
      statement_id: "STL-2024-002",
      payee_type: "rider",
      rider_id: ridersData[0]!.id,
      vendor_id: null,
      amount: 2800,
      payable_amount: 2800,
      settlement_date: new Date("2024-06-10"),
      status: "settled" as const,
      remark: "Rider COD remittance",
      approved_by: usersData[0]!.id,
      settled_by: usersData[1]!.id,
    },
  ];
  for (const settlement of settlementsData) {
    await prisma.settlements.upsert({
      where: { id: settlement.id },
      update: {},
      create: settlement,
    });
    console.log(`💸 Settlement: ${settlement.statement_id}`);
  }
  // =========================================================================
  // 18. Seed Settlement Items
  // =========================================================================
  await prisma.settlement_items.upsert({
    where: {
      settlement_id_cod_collection_id: {
        settlement_id: settlementsData[1]!.id,
        cod_collection_id: codCollectionsData[1]!.id,
      },
    },
    update: {},
    create: {
      settlement_id: settlementsData[1]!.id,
      cod_collection_id: codCollectionsData[1]!.id,
      amount: 2800,
    },
  });
  console.log("📄 Settlement item linked");
  // =========================================================================
  // 19. Seed Support Tickets
  // =========================================================================
  const ticketsData = [
    {
      id: demoUuid("tkt", 1),
      ticket_no: "TKT-2024-001",
      parcel_id: parcelsData[3]!.id,
      customer_name: "Maya Rai",
      customer_phone: "+9779800000014",
      issue_type: "delivery_delay",
      description: "Parcel not delivered after 5 days",
      status: "open" as const,
      assigned_to: usersData[1]!.id,
      created_by: usersData[0]!.id,
      created_at: new Date(today.getTime() - 86400000 * 5),
      updated_at: new Date(today.getTime() - 86400000),
      closed_at: null,
    },
    {
      id: demoUuid("tkt", 2),
      ticket_no: "TKT-2024-002",
      parcel_id: parcelsData[4]!.id,
      customer_name: "Dipak Thapa",
      customer_phone: "+9779800000013",
      issue_type: "hold_inquiry",
      description: "Why is my shipment on hold?",
      status: "in_progress" as const,
      assigned_to: usersData[1]!.id,
      created_by: usersData[2]!.id,
      created_at: new Date(today.getTime() - 86400000 * 7),
      updated_at: new Date(today.getTime() - 86400000 * 2),
      closed_at: null,
    },
  ];
  for (const ticket of ticketsData) {
    await prisma.support_tickets.upsert({
      where: { id: ticket.id },
      update: {},
      create: ticket,
    });
    console.log(`🎫 Ticket: ${ticket.ticket_no}`);
  }
  // =========================================================================
  // 20. Seed Audit Logs
  // =========================================================================
  const auditLogsData = [
    {
      id: demoUuid("adt", 1),
      actor_id: usersData[0]!.id,
      entity_type: "parcels",
      entity_id: parcelsData[0]!.id,
      action: "CREATE",
      old_data: Prisma.DbNull,
      new_data: { tracking_id: "PMV-KTM-2024-001" },
      ip_address: "192.168.1.10",
      user_agent: "Mozilla/5.0",
      created_at: new Date(today.getTime() - 86400000 * 2),
    },
    {
      id: demoUuid("adt", 2),
      actor_id: usersData[1]!.id,
      entity_type: "parcels",
      entity_id: parcelsData[1]!.id,
      action: "STATUS_UPDATE",
      old_data: { status: "pickup_ordered" },
      new_data: { status: "picked_up" },
      ip_address: "192.168.1.11",
      user_agent: "Mozilla/5.0",
      created_at: new Date(today.getTime() - 86400000),
    },
  ];
  for (const log of auditLogsData) {
    await prisma.audit_logs.upsert({
      where: { id: log.id },
      update: {},
      create: log,
    });
    console.log(`📜 Audit log: ${log.action}`);
  }
  // =========================================================================
  // 21. Seed Notifications
  // =========================================================================
  const notificationsData = [
    {
      id: demoUuid("not", 1),
      user_id: usersData[6]!.id,
      title: "Parcel Picked Up",
      body: "Your parcel PMV-KTM-2024-001 has been picked up",
      created_at: new Date(today.getTime() - 86400000 * 2),
    },
    {
      id: demoUuid("not", 2),
      user_id: usersData[7]!.id,
      title: "Parcel Delivered",
      body: "Your parcel PMV-PKR-2024-003 has been delivered successfully",
      read_at: new Date(today.getTime() - 86400000),
      created_at: new Date(today.getTime() - 86400000 * 2),
    },
  ];
  for (const notif of notificationsData) {
    await prisma.notifications.upsert({
      where: { id: notif.id },
      update: {},
      create: notif,
    });
    console.log(`🔔 Notification: ${notif.title}`);
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