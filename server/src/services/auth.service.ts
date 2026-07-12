import crypto from "crypto";
import prisma from "../lib/prisma";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

import { AppError } from "../utils/AppError";
import { sendWelcomeEmail } from "../lib/mailer";
import { revokeAllUserTokens } from "../lib/tokenRevocation";
import { ACCESS_TOKEN_AUDIENCE, JWT_ALGORITHM, JWT_ISSUER } from "../utils/jwtConfig";

import { RegisterUserInput } from "../types/user-registration";
import { ADMIN_PERMISSIONS, AdminPermission } from "../types/adminPermission.type";

interface IuserLoginData {
  email: string;
  password: string;
}

type ManagedUserType = "admin" | "vendor" | "rider";

interface UpdateManagedUserInput {
  type: ManagedUserType;
  fullName?: string;
  phone?: string;
  email?: string;
  status?: "active" | "inactive";
  joinedAt?: string;
  locationId?: string;
  address?: string;
  pan?: string;
  citizenshipNo?: string;
  bankName?: string;
  bankAccountNo?: string;
  bankAccountHolder?: string;
  // admin
  position?: string;
  department?: string;
  idDocumentType?: string;
  idDocumentNumber?: string;
  fatherName?: string;
  motherName?: string;
  grandfatherName?: string;
  permanentAddress?: string;
  currentAddress?: string;
  experience?: string;
  // vendor
  clientName?: string;
  businessName?: string;
  sales?: string;
  salesUserId?: string;
  rateType?: string;
  flatInsideValley?: string | number;
  flatOutsideValley?: string | number;
  zoneMajorCities?: string | number;
  zoneUrbanAreas?: string | number;
  zoneRemoteAreas?: string | number;
  extraWeightPercent?: string | number;
  pickupLandmark?: string;
  billingBusinessName?: string;
  registrationNo?: string;
  panVatNo?: string;
  // rider
  riderLocation?: string;
  licenceNo?: string;
  vehicleNo?: string;
  salaryCommission?: string;
}

// Sets a text field when provided; empty string clears it to null.
function putText(obj: Record<string, unknown>, key: string, val: string | undefined) {
  if (val !== undefined) obj[key] = val.trim() === "" ? null : val.trim();
}
function putRate(obj: Record<string, unknown>, key: string, val: string | number | undefined) {
  if (val === undefined) return;
  if (val === "" || val === null) { obj[key] = null; return; }
  const n = Number(val);
  obj[key] = Number.isFinite(n) ? n : null;
}

// The "Sales" department is the one department that maps to a real RBAC role
// (used for authorization/scoping across finance, orders, tickets, vendors -
// see the `sales` role in prisma/seed-roles.ts). A Sales-department admin
// still gets a normal `admins` profile row, but the `sales` role REPLACES
// the base `admin` role rather than sitting alongside it - every "is this a
// pure sales account" check in the app (client and server) tests for
// `sales` without `admin`, and `admin`/`super_admin` are already treated as
// unrestricted staff wherever vendor/ticket/order data gets scoped to a
// sales rep's own vendors. Leaving `admin` in place would silently grant a
// sales account full admin access instead of the intended vendor-scoped view.
async function syncSalesRoleForDepartment(
  tx: Pick<typeof prisma, "roles" | "user_roles">,
  userId: string,
  department: string | null | undefined,
) {
  const wantsSales = (department ?? "").trim().toLowerCase() === "sales";
  const [salesRole, adminRole] = await Promise.all([
    tx.roles.findUnique({ where: { code: "sales" } }),
    tx.roles.findUnique({ where: { code: "admin" } }),
  ]);
  if (!salesRole || !adminRole) return;

  const [hasSales, hasAdmin] = await Promise.all([
    tx.user_roles.findUnique({
      where: { user_id_role_id: { user_id: userId, role_id: salesRole.id } },
    }),
    tx.user_roles.findUnique({
      where: { user_id_role_id: { user_id: userId, role_id: adminRole.id } },
    }),
  ]);

  if (wantsSales) {
    if (!hasSales) await tx.user_roles.create({ data: { user_id: userId, role_id: salesRole.id } });
    if (hasAdmin) {
      await tx.user_roles.delete({
        where: { user_id_role_id: { user_id: userId, role_id: adminRole.id } },
      });
    }
  } else {
    if (hasSales) {
      await tx.user_roles.delete({
        where: { user_id_role_id: { user_id: userId, role_id: salesRole.id } },
      });
    }
    if (!hasAdmin) await tx.user_roles.create({ data: { user_id: userId, role_id: adminRole.id } });
  }
}

async function assertCanManageUsers(userId: string, targetType?: ManagedUserType) {
  const user = await prisma.users.findUnique({
    where: { id: userId },
    include: {
      user_roles: {
        include: {
          roles: true,
        },
      },
      admins: { select: { permissions: true } },
    },
  });

  if (!user) {
    throw new AppError(404, "Unauthorized");
  }

  const roles = user.user_roles.map((userRole) => userRole.roles.code);
  if (!roles.includes("super_admin") && !roles.includes("admin")) {
    throw new AppError(403, "Unauthorized");
  }

  // Managing fellow admin accounts is a super_admin privilege; a plain admin
  // needs the delegated MANAGE_USERS permission for it.
  if (
    targetType === "admin" &&
    !roles.includes("super_admin") &&
    !(user.admins?.permissions ?? []).includes("MANAGE_USERS")
  ) {
    throw new AppError(403, "Managing admin accounts requires the MANAGE_USERS permission");
  }

  return { roles };
}

// Nobody but a super_admin may touch a super_admin's account - not even an
// admin holding MANAGE_USERS.
async function assertTargetNotProtected(actorRoles: string[], targetUserId: string) {
  if (actorRoles.includes("super_admin")) return;

  const targetRoles = await prisma.user_roles.findMany({
    where: { user_id: targetUserId },
    include: { roles: true },
  });
  if (targetRoles.some((tr) => tr.roles.code === "super_admin")) {
    throw new AppError(403, "Only a super admin can modify a super admin account");
  }
}

function parseJoinedAt(joinedAt?: string) {
  return joinedAt ? new Date(joinedAt) : undefined;
}

async function getManagedProfile(type: ManagedUserType, id: string) {
  if (type === "admin") {
    return prisma.admins.findUnique({ where: { id } });
  }

  if (type === "vendor") {
    return prisma.vendors.findUnique({ where: { id } });
  }

  return prisma.riders.findUnique({ where: { id } });
}

function getProfileUserId(profile: { user_id?: string | null } | null) {
  if (!profile?.user_id) {
    throw new AppError(404, "Linked user account not found");
  }

  return profile.user_id;
}

export async function updateManagedUserProfile(
  actorUserId: string,
  id: string,
  data: UpdateManagedUserInput,
) {
  const { roles: actorRoles } = await assertCanManageUsers(actorUserId, data.type);

  const profile = await getManagedProfile(data.type, id);
  const userId = getProfileUserId(profile);
  await assertTargetNotProtected(actorRoles, userId);

  if (data.status && data.status !== "active" && userId === actorUserId) {
    throw new AppError(400, "You cannot deactivate your own account");
  }

  return prisma.$transaction(async (tx) => {
    const userUpdate: Record<string, unknown> = {};
    if (data.fullName?.trim()) userUpdate.full_name = data.fullName.trim();
    if (data.phone?.trim()) userUpdate.phone = data.phone.trim();
    if (data.email?.trim()) userUpdate.email = data.email.trim();
    // Gates login and the per-request auth middleware, so deactivation locks
    // the account out immediately - not just on the next login.
    if (data.status) userUpdate.status = data.status;

    if (Object.keys(userUpdate).length > 0) {
      userUpdate.updated_at = new Date();
      await tx.users.update({ where: { id: userId }, data: userUpdate });
    }

    const joinedAt = parseJoinedAt(data.joinedAt);

    if (data.type === "admin") {
      const u: Record<string, unknown> = { updated_at: new Date() };
      putText(u, "position", data.position);
      putText(u, "department", data.department);
      putText(u, "address", data.address);
      putText(u, "citizenship_no", data.citizenshipNo);
      putText(u, "pan", data.pan);
      putText(u, "father_name", data.fatherName);
      putText(u, "mother_name", data.motherName);
      putText(u, "grandfather_name", data.grandfatherName);
      putText(u, "permanent_address", data.permanentAddress);
      putText(u, "current_address", data.currentAddress);
      putText(u, "experience", data.experience);
      putText(u, "id_document_type", data.idDocumentType);
      putText(u, "id_document_number", data.idDocumentNumber);
      putText(u, "bank_name", data.bankName);
      putText(u, "bank_account_no", data.bankAccountNo);
      putText(u, "bank_account_holder", data.bankAccountHolder);
      if (data.locationId !== undefined) u.location_id = data.locationId || null;
      if (joinedAt) u.joined_at = joinedAt;
      const updatedAdmin = await tx.admins.update({ where: { id }, data: u });
      if (data.department !== undefined) {
        await syncSalesRoleForDepartment(tx, userId, data.department);
      }
      return updatedAdmin;
    }

    if (data.type === "vendor") {
      const u: Record<string, unknown> = { updated_at: new Date() };
      if (data.clientName?.trim()) u.client_name = data.clientName.trim();
      if (data.businessName?.trim()) u.business_name = data.businessName.trim();
      if (data.phone?.trim()) u.phone = data.phone.trim();
      putText(u, "email", data.email);
      putText(u, "address", data.address);
      putText(u, "sales", data.sales);
      if (data.salesUserId !== undefined) u.sales_user_id = data.salesUserId || null;
      putText(u, "pickup_landmark", data.pickupLandmark);
      putText(u, "billing_business_name", data.billingBusinessName);
      putText(u, "registration_no", data.registrationNo);
      putText(u, "pan_vat_no", data.panVatNo);
      putText(u, "bank_name", data.bankName);
      putText(u, "bank_account_no", data.bankAccountNo);
      putText(u, "bank_account_holder", data.bankAccountHolder);
      if (data.locationId !== undefined) u.location_id = data.locationId || null;
      if (data.rateType && ["per_destination", "zone", "flat"].includes(data.rateType)) u.rate_type = data.rateType;
      putRate(u, "flat_inside_valley", data.flatInsideValley);
      putRate(u, "flat_outside_valley", data.flatOutsideValley);
      putRate(u, "zone_major_cities", data.zoneMajorCities);
      putRate(u, "zone_urban_areas", data.zoneUrbanAreas);
      putRate(u, "zone_remote_areas", data.zoneRemoteAreas);
      putRate(u, "extra_weight_percent", data.extraWeightPercent);
      if (joinedAt) u.joined_at = joinedAt;
      if (data.status) u.status = data.status;
      return tx.vendors.update({ where: { id }, data: u });
    }

    const u: Record<string, unknown> = { updated_at: new Date() };
    if (data.fullName?.trim()) u.name = data.fullName.trim();
    if (data.phone?.trim()) u.phone = data.phone.trim();
    putText(u, "rider_location", data.riderLocation);
    putText(u, "citizenship_no", data.citizenshipNo);
    putText(u, "licence_no", data.licenceNo);
    putText(u, "vehicle_no", data.vehicleNo);
    putText(u, "salary_commission", data.salaryCommission);
    putText(u, "pan", data.pan);
    putText(u, "bank_name", data.bankName);
    putText(u, "bank_account_no", data.bankAccountNo);
    putText(u, "bank_account_holder", data.bankAccountHolder);
    if (data.locationId !== undefined) u.location_id = data.locationId || null;
    if (joinedAt) u.joined_at = joinedAt;
    if (data.status) u.status = data.status;
    return tx.riders.update({ where: { id }, data: u });
  });
}

// Full editable profile for the edit form, mapped to the create-form field names.
// Contains bank/PAN/citizenship-level PII, so only admins may fetch it.
export async function getManagedUserDetail(actorUserId: string, type: ManagedUserType, id: string) {
  await assertCanManageUsers(actorUserId, type);

  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const dateStr = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");

  if (type === "vendor") {
    const v = await prisma.vendors.findUnique({ where: { id }, include: { users: true } });
    if (!v) throw new AppError(404, "Vendor not found");
    return {
      type, id: v.id, userId: v.user_id,
      clientName: v.client_name, businessName: v.business_name, phone: v.phone,
      email: v.email, locationId: v.location_id, address: v.address, sales: v.sales,
      salesUserId: v.sales_user_id,
      rateType: v.rate_type,
      flatInsideValley: num(v.flat_inside_valley), flatOutsideValley: num(v.flat_outside_valley),
      zoneMajorCities: num(v.zone_major_cities), zoneUrbanAreas: num(v.zone_urban_areas),
      zoneRemoteAreas: num(v.zone_remote_areas),
      extraWeightPercent: num(v.extra_weight_percent),
      pickupLandmark: v.pickup_landmark, billingBusinessName: v.billing_business_name,
      registrationNo: v.registration_no, panVatNo: v.pan_vat_no,
      bankName: v.bank_name, bankAccountNo: v.bank_account_no, bankAccountHolder: v.bank_account_holder,
      joinedAt: dateStr(v.joined_at),
    };
  }

  if (type === "admin") {
    const a = await prisma.admins.findUnique({ where: { id }, include: { users: true } });
    if (!a) throw new AppError(404, "Admin not found");
    return {
      type, id: a.id, userId: a.user_id,
      fullName: a.users.full_name, email: a.users.email, phone: a.users.phone,
      locationId: a.location_id, position: a.position, department: a.department,
      address: a.address, citizenshipNo: a.citizenship_no, pan: a.pan,
      fatherName: a.father_name, motherName: a.mother_name, grandfatherName: a.grandfather_name,
      permanentAddress: a.permanent_address, currentAddress: a.current_address, experience: a.experience,
      idDocumentType: a.id_document_type, idDocumentNumber: a.id_document_number,
      bankName: a.bank_name, bankAccountNo: a.bank_account_no, bankAccountHolder: a.bank_account_holder,
      joinedAt: dateStr(a.joined_at),
    };
  }

  const r = await prisma.riders.findUnique({ where: { id }, include: { users: true } });
  if (!r) throw new AppError(404, "Rider not found");
  return {
    type, id: r.id, userId: r.user_id,
    fullName: r.name, email: r.users?.email ?? "", phone: r.phone,
    locationId: r.location_id, riderLocation: r.rider_location,
    citizenshipNo: r.citizenship_no, licenceNo: r.licence_no, vehicleNo: r.vehicle_no,
    salaryCommission: r.salary_commission, pan: r.pan,
    bankName: r.bank_name, bankAccountNo: r.bank_account_no, bankAccountHolder: r.bank_account_holder,
    joinedAt: dateStr(r.joined_at),
  };
}

export async function updateManagedUserPassword(
  actorUserId: string,
  type: ManagedUserType,
  id: string,
  password: string,
) {
  const { roles: actorRoles } = await assertCanManageUsers(actorUserId, type);

  if (!password?.trim() || password.length < 8) {
    throw new AppError(400, "Password must be at least 8 characters long");
  }

  const profile = await getManagedProfile(type, id);
  const userId = getProfileUserId(profile);
  await assertTargetNotProtected(actorRoles, userId);
  const passwordHash = await bcrypt.hash(password, 12);

  // An admin resetting someone else's password is exactly the "credentials
  // may be compromised" case revokeAllUserTokens exists for (unlike
  // self-service changePassword, there's no "current session" to keep
  // alive here), and the user should have to prove they know the new
  // password on their very next request rather than being auto-trusted.
  await revokeAllUserTokens(userId);

  return prisma.users.update({
    where: { id: userId },
    data: {
      password_hash: passwordHash,
      must_change_password: true,
      updated_at: new Date(),
    },
  });
}

// Super-admin only: set the delegated permission list on an admin (staff)
// account. Replaces the whole list, so revoking is just saving without a code.
export async function updateAdminPermissions(
  actorUserId: string,
  adminId: string,
  permissions: string[],
) {
  const actor = await prisma.users.findUnique({
    where: { id: actorUserId },
    include: { user_roles: { include: { roles: true } } },
  });
  const actorRoles = actor?.user_roles.map((ur) => ur.roles.code) ?? [];
  if (!actorRoles.includes("super_admin")) {
    throw new AppError(403, "Only a super admin can grant admin permissions");
  }

  const invalid = permissions.filter(
    (p) => !ADMIN_PERMISSIONS.includes(p as AdminPermission),
  );
  if (invalid.length > 0) {
    throw new AppError(400, `Unknown permission(s): ${invalid.join(", ")}`);
  }

  const admin = await prisma.admins.findUnique({
    where: { id: adminId },
    include: { users: { include: { user_roles: { include: { roles: true } } } } },
  });
  if (!admin) {
    throw new AppError(404, "Admin not found");
  }
  const targetRoles = admin.users.user_roles.map((ur) => ur.roles.code);
  if (targetRoles.includes("super_admin")) {
    throw new AppError(400, "A super admin already holds every permission");
  }

  const updated = await prisma.admins.update({
    where: { id: adminId },
    data: { permissions: [...new Set(permissions)], updated_at: new Date() },
    select: { id: true, permissions: true },
  });

  return updated;
}



function validateRegisterInput(input: RegisterUserInput) {
  if (!input.type) {
    throw new AppError(400, "User type is required");
  }

  if (!["admin", "vendor", "rider"].includes(input.type)) {
    throw new AppError(400, "Invalid user type");
  }

  if (!input.fullName?.trim()) {
    throw new AppError(400, "Full name is required");
  }

  if (!input.email?.trim()) {
    throw new AppError(400, "Email is required");
  }

  if (!input.password.trim() || input.password.length < 8) {
    throw new AppError(
      400,
      "Password is required and must be at least 8 characters long",
    );
  }

  if (input.type === "vendor") {
    if (!input.clientName?.trim()) {
      throw new AppError(400, "Client name is required for vendor");
    }

    if (!input.businessName?.trim()) {
      throw new AppError(400, "Business name is required for vendor");
    }

    if (!input.phone?.trim()) {
      throw new AppError(400, "Phone number is required for vendor");
    }

    if (!input.pickupLandmark?.trim()) {
      throw new AppError(400, "Location is required for vendor");
    }
  }

  if (input.type === "rider") {
    if (!input.phone?.trim()) {
      throw new AppError(400, "Phone number is required for rider");
    }
  }

  if (input.type === "admin") {
    if (!input.position?.trim()) {
      throw new AppError(400, "Position is required for admin");
    }
  }
}

// Parses an optional rate value (string over multipart) to a number, or null
// when blank/invalid so the global default rate applies instead.
function parseRate(value: string | number | undefined): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function registerUserBySuperAdmin(
  superAdminUserID: string,
  data: RegisterUserInput,
) {

  
  const superAdmin = await prisma.users.findUnique({
    where: { id: superAdminUserID },
    include: {
      user_roles: {
        include: {
          roles: true,
        },
      },
      admins: { select: { permissions: true } },
    },
  });
  if (!superAdmin) {
    throw new AppError(404, "Unauthorized");
  }

  const creatorRoles = superAdmin?.user_roles.map((userRole) => userRole.roles.code);

  const isSuperAdmin = creatorRoles.includes("super_admin");
  const isAdmin = creatorRoles.includes("admin");
  const isSales = creatorRoles.includes("sales");
  // Delegated by a super_admin: lets a plain admin create every account type.
  const canManageUsers =
    isSuperAdmin || (superAdmin.admins?.permissions ?? []).includes("MANAGE_USERS");

  if (!isSuperAdmin && !isAdmin && !isSales) {
    throw new AppError(403, "Unauthorized");
  }

  if (!canManageUsers && isAdmin && !["rider", "vendor"].includes(data.type)) {
    throw new AppError(403, "Admins can only create vendor or rider accounts");
  }

  // Sales (without admin rights) may only onboard vendor (client) accounts, and
  // those are always linked to the sales user who created them.
  if (!isSuperAdmin && !isAdmin && isSales) {
    if (data.type !== "vendor") {
      throw new AppError(403, "Sales can only create vendor accounts");
    }
    data.salesUserId = superAdminUserID;
  }

  validateRegisterInput(data);

  const role = await prisma.roles.findUnique({
    where: { code: data.type },
  });

  if (!role) {
    throw new AppError(
      400,
      `Role '${data.type}' does not exist in the system`,
    );
  }

  const passwordHash = await bcrypt.hash(data.password, 12);

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.users.create({
      data: {
        full_name: data.fullName,
        email: data.email,
        phone: data.phone,
        password_hash: passwordHash,
        status: "active",
        must_change_password: true,
      },
    });

    await tx.user_roles.create({
      data: {
        user_id: user.id,
        role_id: role.id,
      },
    });

    if (data.type === "admin") {
      const admin = await tx.admins.create({
        data: {
          user_id: user.id,
          location_id: data.locationId ?? null,
          position: data.position ?? null,
          department: data.department ?? null,
          id_document_type: data.idDocumentType ?? null,
          id_document_number: data.idDocumentNumber ?? null,
          id_document: data.idDocumentPath ?? null,
          address: data.address ?? null,
          citizenship_no: data.citizenshipNo ?? null,
          pan: data.pan ?? null,
          father_name: data.fatherName ?? null,
          mother_name: data.motherName ?? null,
          grandfather_name: data.grandfatherName ?? null,
          permanent_address: data.permanentAddress ?? null,
          current_address: data.currentAddress ?? null,
          experience: data.experience ?? null,
          citizenship_doc: data.citizenshipDocPath ?? null,
          pan_doc: data.panDocPath ?? null,
          experience_letter_doc: data.experienceLetterDocPath ?? null,
          bank_name: data.bankName ?? null,
          bank_account_no: data.bankAccountNo ?? null,
          bank_account_holder: data.bankAccountHolder ?? null,
          joined_at: data.joinedAt ? new Date(data.joinedAt) : null,
        },
      });
      await syncSalesRoleForDepartment(tx, user.id, data.department);
      return { user, profile: admin, role: data.type };
    }

    if (data.type === "vendor") {
      const vendor = await tx.vendors.create({
        data: {
          user_id: user.id,
          client_name: data.clientName!,
          business_name: data.businessName!,
          phone: data.phone!,
          email: data.email!,
          location_id: data.locationId ?? null,
          address: data.address ?? null,
          sales: data.sales ?? null,
          sales_user_id: data.salesUserId ?? null,
          rate_type: ["per_destination", "zone", "flat"].includes(data.rateType ?? "")
            ? data.rateType!
            : "flat",
          flat_inside_valley: parseRate(data.flatInsideValley),
          flat_outside_valley: parseRate(data.flatOutsideValley),
          zone_major_cities: parseRate(data.zoneMajorCities),
          zone_urban_areas: parseRate(data.zoneUrbanAreas),
          zone_remote_areas: parseRate(data.zoneRemoteAreas),
          extra_weight_percent: parseRate(data.extraWeightPercent),
          pickup_landmark: data.pickupLandmark ?? null,
          billing_business_name: data.billingBusinessName ?? null,
          registration_no: data.registrationNo ?? null,
          pan_vat_no: data.panVatNo ?? null,
          citizenship_doc: data.citizenshipDocPath ?? null,
          pan_vat_doc: data.panVatDocPath ?? null,
          business_cert_doc: data.businessCertDocPath ?? null,
          bank_name: data.bankName ?? null,
          bank_account_no: data.bankAccountNo ?? null,
          bank_account_holder: data.bankAccountHolder ?? null,
          status: "active",
          joined_at: data.joinedAt ? new Date(data.joinedAt) : null,
        },
      });
      return { user, profile: vendor, role: data.type };
    }

    const raider = await tx.riders.create({
      data: {
        user_id: user.id,
        name: data.fullName,
        phone: data.phone!,
        location_id: data.locationId ?? null,
        rider_location: data.riderLocation ?? null,
        citizenship_no: data.citizenshipNo ?? null,
        licence_no: data.licenceNo ?? null,
        vehicle_no: data.vehicleNo ?? null,
        salary_commission: data.salaryCommission ?? null,
        pan: data.pan ?? null,
        citizenship_doc: data.citizenshipDocPath ?? null,
        pan_vat_doc: data.panVatDocPath ?? null,
        licence_doc: data.licenceDocPath ?? null,
        bluebook_doc: data.bluebookDocPath ?? null,
        bank_name: data.bankName ?? null,
        bank_account_no: data.bankAccountNo ?? null,
        bank_account_holder: data.bankAccountHolder ?? null,
        status: "active",
        joined_at: data.joinedAt ? new Date(data.joinedAt) : null,
      },
    });
    return { user, profile: raider, role: data.type };
  });

  // Fire-and-forget: email failure must not roll back the registration.
  sendWelcomeEmail({
    to: data.email,
    name: data.fullName,
    password: data.password,
  }).catch((err) => console.error("Welcome email failed:", err));

  return result;
}
export async function loginUser(data: IuserLoginData) {
  try {
    const user = await prisma.users.findUnique({
      where: { email: data.email },
      include: { user_roles: { include: { roles: true } } },
    });

    if (!user || !user.password_hash) {
      throw new AppError(401, "Invalid email or password");
    }

    if (user.status !== "active" || user.deleted_at) {
      throw new AppError(403, "Your account has been deactivated", "ACCOUNT_INACTIVE");
    }

    const isValid = await bcrypt.compare(data.password, user.password_hash);
    if (!isValid) {
      throw new AppError(401, "Invalid email or password");
    }

    if (!process.env.JWT_SECRET) {
      throw new AppError(500, "JWT secret not configured");
    }

    const roles = user.user_roles.map((url) => url.roles.code);

    // For vendor_staff and plain admins, surface their permission list so the
    // frontend can render only the nav items they're allowed to access.
    let staffPermissions: string[] | undefined;
    if (roles.includes("vendor_staff")) {
      const staffRecord = await prisma.vendor_staff.findFirst({
        where: { user_id: user.id, deleted_at: null, enabled: true },
        select: { permissions: true },
      });
      staffPermissions = (staffRecord?.permissions ?? []) as string[];
    } else if (roles.includes("admin") && !roles.includes("super_admin")) {
      const adminRecord = await prisma.admins.findFirst({
        where: { user_id: user.id },
        select: { permissions: true },
      });
      staffPermissions = adminRecord?.permissions ?? [];
    }

    const mustChangePassword = user.must_change_password;

    const token = jwt.sign(
      { id: user.id, roles, mustChangePassword },
      process.env.JWT_SECRET,
      {
        expiresIn: "7d",
        jwtid: crypto.randomUUID(),
        algorithm: JWT_ALGORITHM,
        issuer: JWT_ISSUER,
        audience: ACCESS_TOKEN_AUDIENCE,
      },
    );

    await prisma.users.update({
      where: { id: user.id },
      data: { last_login_at: new Date() },
    });

    return {
      token,
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        phone: user.phone,
        status: user.status,
        roles,
        mustChangePassword,
        ...(staffPermissions !== undefined && { permissions: staffPermissions }),
      }
    }

  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    console.error("Login service error:", error);
    throw new AppError(500, "Error occurred while logging in");
  }
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
) {
  if (!newPassword || newPassword.length < 8) {
    throw new AppError(400, "New password must be at least 8 characters");
  }

  const user = await prisma.users.findUnique({ where: { id: userId } });
  if (!user || !user.password_hash) throw new AppError(404, "User not found");

  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) throw new AppError(401, "Current password is incorrect");

  if (currentPassword === newPassword) {
    throw new AppError(400, "New password must be different from the current password");
  }

  const hash = await bcrypt.hash(newPassword, 12);
  await prisma.users.update({
    where: { id: userId },
    data: { password_hash: hash, must_change_password: false, updated_at: new Date() },
  });

  // A password change should kill every other session (e.g. a stolen token) -
  // but the caller just authenticated with their *current* token to get here,
  // so reissue a fresh one rather than logging them out too.
  await revokeAllUserTokens(userId);

  if (!process.env.JWT_SECRET) {
    throw new AppError(500, "JWT secret not configured");
  }
  const roles = (
    await prisma.user_roles.findMany({ where: { user_id: userId }, include: { roles: true } })
  ).map((ur) => ur.roles.code);

  const token = jwt.sign(
    { id: userId, roles, mustChangePassword: false },
    process.env.JWT_SECRET,
    {
      expiresIn: "7d",
      jwtid: crypto.randomUUID(),
      algorithm: JWT_ALGORITHM,
      issuer: JWT_ISSUER,
      audience: ACCESS_TOKEN_AUDIENCE,
    },
  );

  return { token };
}

export async function getCurrentUserProfile(userId: string) {
  const user = await prisma.users.findUnique({
    where: { id: userId },
    include: {
      user_roles: { include: { roles: true } },
      admins: { include: { locations: true } },
    },
  });
  if (!user) throw new AppError(404, "User not found");

  return {
    id: user.id,
    fullName: user.full_name,
    email: user.email,
    phone: user.phone,
    status: user.status,
    roles: user.user_roles.map((userRole) => userRole.roles.code),
    hubId: user.admins?.location_id ?? null,
    hubName: user.admins?.locations?.name ?? null,
    // Delegated permissions for plain admin accounts (super_admin holds all).
    permissions: user.admins?.permissions ?? [],
  };
}

export async function updateCurrentUserProfile(userId: string, input: { fullName?: string; phone?: string }) {
  if (!input.fullName?.trim()) throw new AppError(400, "Full name is required");

  try {
    const updated = await prisma.users.update({
      where: { id: userId },
      data: {
        full_name: input.fullName.trim(),
        phone: input.phone?.trim() || null,
        updated_at: new Date(),
      },
    });

    return {
      id: updated.id,
      fullName: updated.full_name,
      email: updated.email,
      phone: updated.phone,
    };
  } catch (error: any) {
    if (error.code === "P2002") {
      throw new AppError(409, "Phone number already in use");
    }
    throw error;
  }
}
