import prisma from "../lib/prisma";
import { AppError } from "../utils/AppError";
import { STAFF_PERMISSIONS, StaffInput, StaffPermission } from "../types/staff.type";

type Actor = { id: string; roles: string[] };

const VALID_PERMISSIONS = new Set<string>(STAFF_PERMISSIONS);

// Staff are owned by the acting vendor; resolve (and assert) that vendor first.
async function resolveVendorId(actor: Actor): Promise<string> {
  const vendor = await prisma.vendors.findFirst({
    where: { user_id: actor.id, deleted_at: null },
    select: { id: true },
  });
  if (!vendor) {
    throw new AppError(403, "Only vendors can manage staff");
  }
  return vendor.id;
}

function sanitizePermissions(permissions: unknown): StaffPermission[] {
  if (!Array.isArray(permissions)) {
    throw new AppError(400, "permissions must be an array");
  }
  const cleaned = permissions.filter(
    (p): p is StaffPermission => typeof p === "string" && VALID_PERMISSIONS.has(p),
  );
  if (cleaned.length === 0) {
    throw new AppError(400, "Select at least one valid permission");
  }
  // De-dupe while preserving order.
  return Array.from(new Set(cleaned));
}

function validateInput(input: StaffInput) {
  if (!input.name?.trim()) throw new AppError(400, "Name is required");
  if (!input.email?.trim()) throw new AppError(400, "Email is required");
  return {
    name: input.name.trim(),
    email: input.email.trim(),
    permissions: sanitizePermissions(input.permissions),
    enabled: input.enabled ?? true,
  };
}

function mapStaff(staff: {
  id: string;
  name: string;
  email: string;
  permissions: string[];
  enabled: boolean;
}) {
  return {
    id: staff.id,
    name: staff.name,
    email: staff.email,
    permissions: staff.permissions,
    enabled: staff.enabled,
  };
}

export async function listStaff(actor: Actor) {
  const vendorId = await resolveVendorId(actor);
  const staff = await prisma.vendor_staff.findMany({
    where: { vendor_id: vendorId, deleted_at: null },
    orderBy: { created_at: "asc" },
  });
  return staff.map(mapStaff);
}

export async function createStaff(actor: Actor, input: StaffInput) {
  const vendorId = await resolveVendorId(actor);
  const data = validateInput(input);

  const staff = await prisma.vendor_staff.create({
    data: {
      vendor_id: vendorId,
      created_by: actor.id,
      name: data.name,
      email: data.email,
      permissions: data.permissions,
      enabled: data.enabled,
    },
  });
  return mapStaff(staff);
}

async function assertOwnedStaff(vendorId: string, id: string) {
  const existing = await prisma.vendor_staff.findFirst({
    where: { id, vendor_id: vendorId, deleted_at: null },
    select: { id: true },
  });
  if (!existing) {
    throw new AppError(404, "Staff not found");
  }
}

export async function updateStaff(actor: Actor, id: string, input: StaffInput) {
  const vendorId = await resolveVendorId(actor);
  await assertOwnedStaff(vendorId, id);
  const data = validateInput(input);

  const staff = await prisma.vendor_staff.update({
    where: { id },
    data: {
      name: data.name,
      email: data.email,
      permissions: data.permissions,
      enabled: data.enabled,
      updated_at: new Date(),
    },
  });
  return mapStaff(staff);
}

export async function setStaffEnabled(actor: Actor, id: string, enabled: boolean) {
  const vendorId = await resolveVendorId(actor);
  await assertOwnedStaff(vendorId, id);

  const staff = await prisma.vendor_staff.update({
    where: { id },
    data: { enabled, updated_at: new Date() },
  });
  return mapStaff(staff);
}
