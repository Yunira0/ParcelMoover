// Demo data for local testing: 10 internal ops staff + 50 vendors, split across
// three "creators" to exercise hub inheritance (see memory
// hub-inheritance-root-superadmin / registerUserBySuperAdmin): a plain admin's
// creations are forced to that admin's own hub, only super_admin can pick freely.
//
// - 5 dispatch/ops admins + 5 sales reps, one pair per hub (10 staff total).
// - 15 vendors "by superadmin": free choice, spread across 10 different hubs.
// - 25 vendors "by staff": 5 per dispatch admin, locked to that admin's hub.
// - 10 vendors "by sales": 2 per sales rep, locked to that rep's hub, with
//   sales_user_id/sales set so they show up as that rep's accounts.
//
// vendors has no created_by column, so "creator" isn't literally stored -
// the hub-lock pattern and sales_user_id linkage are what stand in for it.
//
// Usage: npx ts-node --transpile-only prisma/seed-vendors-staff.ts
import "dotenv/config";
import * as bcrypt from "bcrypt";
import prisma from "../src/lib/prisma";

const DEMO_PASSWORD = "DemoPass123!";

const HUBS = [
  "Imadol",
  "POKHARA - KASKI",
  "BIRATNAGAR - MORANG",
  "BUTWAL - RUPANDEHI",
  "BIRGUNJ - PARSA",
] as const;

// Extra hubs superadmin can freely pick from, beyond the 5 staff hubs above.
const EXTRA_HUBS = [
  "DHARAN - SUNSARI",
  "HETAUDA - MAKWANPUR",
  "NEPALGUNJ - BANKE",
  "ITAHARI - SUNSARI",
  "BHAIRAHAWA - RUPANDEHI",
] as const;

const STAFF = [
  { name: "Suman Adhikari", dept: "Operations", position: "Dispatch Manager", hub: "Imadol" },
  { name: "Anita Karki", dept: "Sales", position: "Sales Executive", hub: "Imadol" },
  { name: "Bikash Thapa", dept: "Operations", position: "Dispatch Manager", hub: "POKHARA - KASKI" },
  { name: "Puja Rai", dept: "Sales", position: "Sales Executive", hub: "POKHARA - KASKI" },
  { name: "Rajesh Poudel", dept: "Operations", position: "Dispatch Manager", hub: "BIRATNAGAR - MORANG" },
  { name: "Sabina Magar", dept: "Sales", position: "Sales Executive", hub: "BIRATNAGAR - MORANG" },
  { name: "Dipesh Shrestha", dept: "Operations", position: "Dispatch Manager", hub: "BUTWAL - RUPANDEHI" },
  { name: "Kritika Basnet", dept: "Sales", position: "Sales Executive", hub: "BUTWAL - RUPANDEHI" },
  { name: "Nabin Chaudhary", dept: "Operations", position: "Dispatch Manager", hub: "BIRGUNJ - PARSA" },
  { name: "Manisha Joshi", dept: "Sales", position: "Sales Executive", hub: "BIRGUNJ - PARSA" },
] as const;

const VENDOR_NAMES = [
  ["Hari Bahadur Thapa", "Everest Trading Concern"],
  ["Sita Kumari Gurung", "Himal Electronics"],
  ["Ramesh Shrestha", "Baneshwor Fashion House"],
  ["Kamala Devi Yadav", "Newroad Cosmetics"],
  ["Suresh Karki", "Annapurna Hardware Suppliers"],
  ["Nirmala Rai", "Patan Handicrafts"],
  ["Dinesh Basnet", "Kathmandu Book House"],
  ["Sarita Magar", "Lakeside Boutique"],
  ["Prakash Adhikari", "Machhapuchhre Mobile Store"],
  ["Mina Tamang", "Chitwan Organic Foods"],
  ["Ganesh Poudel", "Koshi General Store"],
  ["Laxmi Chaudhary", "Terai Textiles"],
  ["Bikram Shahi", "Dharan Sports Zone"],
  ["Sabnam Khadka", "Itahari Bakery Supplies"],
  ["Rabin Bhattarai", "Biratnagar Auto Parts"],
  ["Anisha Neupane", "Jhapa Tea Traders"],
  ["Kishor Regmi", "Sunsari Furniture Mart"],
  ["Puja Sharma", "Butwal Footwear Emporium"],
  ["Nabin Kunwar", "Rupandehi Agro Suppliers"],
  ["Sanju Bista", "Bhairahawa Grocery Mart"],
  ["Deepak Lama", "Lumbini Stationery House"],
  ["Sunita Ghimire", "Pokhara Toy World"],
  ["Rajan Pandey", "Kaski Watch Gallery"],
  ["Meena Acharya", "Baglung Home Decor"],
  ["Kumar Bhandari", "Gorkha Sports Wear"],
  ["Sita Rana", "Tanahu Baby Care"],
  ["Bishnu Sunar", "Damauli Kitchenware"],
  ["Ranjita Dahal", "Hetauda Plastic Traders"],
  ["Tek Bahadur Rokka", "Makwanpur Paint House"],
  ["Gita Sapkota", "Bara Textiles Depot"],
  ["Yubraj Katuwal", "Birgunj Import Export"],
  ["Radha Oli", "Parsa Confectionery"],
  ["Krishna Bogati", "Nepalgunj Cycle Store"],
  ["Sangita Bam", "Banke Leather Works"],
  ["Ramkrishna Devkota", "Dang Farming Supplies"],
  ["Bimala Air", "Surkhet Beauty Parlour Supplies"],
  ["Hom Bahadur Malla", "Doti Electronics Hub"],
  ["Champa Nepali", "Dadeldhura Fabric Store"],
  ["Yagya Prasad Joshi", "Kailali Rice Traders"],
  ["Devi Maya Bhusal", "Kanchanpur Dairy Products"],
  ["Arjun Bhurtel", "Dhangadhi Motor Spares"],
  ["Purnima Khatri", "Sindhuli Herbal Products"],
  ["Kabindra Baral", "Ramechhap Timber Traders"],
  ["Shova Silwal", "Okhaldhunga Wool Traders"],
  ["Narayan Pokhrel", "Bhojpur Copperware"],
  ["Indira Bhattachan", "Ilam Tea Estate Supplies"],
  ["Motilal Shrestha", "Panchthar Spice Traders"],
  ["Kavita Limbu", "Taplejung Handloom"],
  ["Padam Rai", "Solukhumbu Trekking Gear"],
  ["Sarala KC", "Khotang Poultry Supplies"],
] as const;

async function main() {
  if (process.env.NODE_ENV === "production") {
    console.error("Refusing to run demo vendor/staff seed with NODE_ENV=production.");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const [adminRole, salesRole, vendorRole] = await Promise.all([
    prisma.roles.upsert({
      where: { code: "admin" },
      update: {},
      create: { code: "admin", name: "Admin", description: "Branch management" },
    }),
    prisma.roles.upsert({
      where: { code: "sales" },
      update: {},
      create: { code: "sales", name: "Sales", description: "Vendor onboarding" },
    }),
    prisma.roles.upsert({
      where: { code: "vendor" },
      update: {},
      create: { code: "vendor", name: "Vendor", description: "Merchant access" },
    }),
  ]);

  const hubLocations = new Map<string, { id: string }>();
  for (const name of [...HUBS, ...EXTRA_HUBS]) {
    const loc = await prisma.locations.findFirst({ where: { name, is_hub: true } });
    if (!loc) throw new Error(`Hub location not found: ${name}`);
    hubLocations.set(name, loc);
  }

  // ===========================================================================
  // 10 internal ops staff (admins) - one dispatch admin + one sales rep per hub.
  // ===========================================================================
  console.log("Seeding staff...");
  const staffUsers: { name: string; dept: string; userId: string; hubId: string }[] = [];
  for (let i = 0; i < STAFF.length; i++) {
    const s = STAFF[i]!;
    const slug = s.name.toLowerCase().replace(/\s+/g, ".");
    const email = `${slug}@parcelmoover.com`;
    // Nepali mobile numbers are exactly 10 digits after the country code
    // (9[78]\d{8}) - "9841" + a 6-digit index gets us there.
    const phone = `+9779841${(i + 1).toString().padStart(6, "0")}`;
    const hub = hubLocations.get(s.hub)!;

    const user = await prisma.users.upsert({
      where: { email },
      update: {},
      create: {
        full_name: s.name,
        email,
        phone,
        status: "active",
        password_hash: passwordHash,
      },
    });

    await prisma.admins.upsert({
      where: { user_id: user.id },
      update: {},
      create: {
        user_id: user.id,
        location_id: hub.id,
        position: s.position,
        department: s.dept,
        joined_at: new Date(),
      },
    });

    const role = s.dept === "Sales" ? salesRole : adminRole;
    await prisma.user_roles.upsert({
      where: { user_id_role_id: { user_id: user.id, role_id: role.id } },
      update: {},
      create: { user_id: user.id, role_id: role.id },
    });

    staffUsers.push({ name: s.name, dept: s.dept, userId: user.id, hubId: hub.id });
    console.log(`  staff: ${s.name} (${s.dept}, ${s.hub})`);
  }

  const dispatchStaff = staffUsers.filter((s) => s.dept !== "Sales");
  const salesStaff = staffUsers.filter((s) => s.dept === "Sales");

  // ===========================================================================
  // 50 vendors: 15 free-hub (superadmin), 25 hub-locked to a dispatch admin,
  // 10 hub-locked + attributed to a sales rep.
  // ===========================================================================
  console.log("Seeding vendors...");
  const allHubIds = [...hubLocations.values()].map((h) => h.id);
  let vendorIndex = 0;

  for (let i = 0; i < VENDOR_NAMES.length; i++) {
    const [clientName, businessName] = VENDOR_NAMES[i]!;
    vendorIndex++;
    const slug = businessName
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .replace(/\s+/g, "");
    const email = `contact@${slug}.com`;
    // Same fix as the staff phone above - needs exactly 10 digits after +977.
    const phone = `+9779842${vendorIndex.toString().padStart(6, "0")}`;

    let locationId: string;
    let salesUserId: string | null = null;
    let salesLabel: string | null = null;

    if (i < 15) {
      // superadmin: free choice across all 10 hubs
      locationId = allHubIds[i % allHubIds.length]!;
    } else if (i < 40) {
      // 25 vendors, 5 per dispatch admin, locked to their hub
      const staff = dispatchStaff[Math.floor((i - 15) / 5) % dispatchStaff.length]!;
      locationId = staff.hubId;
    } else {
      // 10 vendors, 2 per sales rep, locked to their hub + attributed to them
      const staff = salesStaff[Math.floor((i - 40) / 2) % salesStaff.length]!;
      locationId = staff.hubId;
      salesUserId = staff.userId;
      salesLabel = staff.name;
    }

    const vendorUser = await prisma.users.upsert({
      where: { email },
      update: {},
      create: {
        full_name: clientName,
        email,
        phone,
        status: "active",
        password_hash: passwordHash,
      },
    });

    await prisma.vendors.upsert({
      where: { user_id: vendorUser.id },
      update: {},
      create: {
        user_id: vendorUser.id,
        client_name: clientName,
        business_name: businessName,
        phone,
        email,
        location_id: locationId,
        address: `${businessName}, Nepal`,
        status: "active",
        joined_at: new Date(),
        sales_user_id: salesUserId,
        sales: salesLabel,
      },
    });

    await prisma.user_roles.upsert({
      where: { user_id_role_id: { user_id: vendorUser.id, role_id: vendorRole.id } },
      update: {},
      create: { user_id: vendorUser.id, role_id: vendorRole.id },
    });

    console.log(`  vendor: ${businessName}`);
  }

  console.log(`\nDone: ${STAFF.length} staff, ${VENDOR_NAMES.length} vendors. Password for all: ${DEMO_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
