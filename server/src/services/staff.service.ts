import bcrypt from "bcrypt";
import prisma from "../lib/prisma";
import { AppError } from "../utils/AppError";
import { sendWelcomeEmail } from "../lib/mailer";
import { STAFF_PERMISSIONS, StaffInput, StaffPermission } from "../types/staff.type";

type Actor = { id: string; roles: string[] };

const VALID_PERMISSIONS = new Set<string>(STAFF_PERMISSIONS);
const MIN_PASSWORD_LENGTH = 8;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function resolveVendorId(actor: Actor): Promise<string> {
  const vendor = await prisma.vendors.findFirst({
    where: { user_id: actor.id, deleted_at: null },
    select: { id: true },
  });
  if (!vendor) throw new AppError(403, "Only vendors can manage staff");
  return vendor.id;
}

function sanitizePermissions(permissions: unknown): StaffPermission[] {
  if (!Array.isArray(permissions)) throw new AppError(400, "permissions must be an array");
  const cleaned = permissions.filter(
    (p): p is StaffPermission => typeof p === "string" && VALID_PERMISSIONS.has(p),
  );
  if (cleaned.length === 0) throw new AppError(400, "Select at least one valid permission");
  return Array.from(new Set(cleaned));
}

const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 255;
// Nepali mobile: 10 digits starting 97/98, optional +977 (mirrors phoneSchema).
const PHONE_RE = /^(?:\+?977)?9[78]\d{8}$/;

function validateInput(input: StaffInput) {
  if (!input.name?.trim()) throw new AppError(400, "Name is required");
  if (input.name.trim().length > MAX_NAME_LENGTH) throw new AppError(400, `Name must be ${MAX_NAME_LENGTH} characters or fewer`);
  if (!input.email?.trim()) throw new AppError(400, "Email is required");
  const email = input.email.trim().toLowerCase();
  if (email.length > MAX_EMAIL_LENGTH) throw new AppError(400, `Email must be ${MAX_EMAIL_LENGTH} characters or fewer`);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError(400, "Invalid email address");
  // Phone is required; must be a valid Nepali mobile number.
  const phone = input.phone?.trim() ?? "";
  if (!phone) throw new AppError(400, "Phone number is required");
  if (!PHONE_RE.test(phone)) throw new AppError(400, "Enter a valid Nepali mobile number (e.g. 98XXXXXXXX)");
  return {
    name: input.name.trim(),
    email,
    phone,
    permissions: sanitizePermissions(input.permissions),
    enabled: input.enabled ?? true,
  };
}

// Returns the non-empty password if it passes policy, null if blank (edit-mode skip).
function validatePassword(password: string | undefined, required: boolean): string | null {
  if (!password || password.trim() === "") {
    if (required) throw new AppError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    return null;
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new AppError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  return password;
}

async function getVendorStaffRoleId(): Promise<string> {
  const role = await prisma.roles.findUnique({ where: { code: "vendor_staff" } });
  if (!role) throw new AppError(500, "vendor_staff role not seeded — run migrations");
  return role.id;
}

async function assertOwnedStaff(vendorId: string, id: string) {
  const existing = await prisma.vendor_staff.findFirst({
    where: { id, vendor_id: vendorId, deleted_at: null },
    select: { id: true },
  });
  if (!existing) throw new AppError(404, "Staff not found");
}

function mapStaff(staff: {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  permissions: string[];
  enabled: boolean;
}) {
  return {
    id: staff.id,
    name: staff.name,
    email: staff.email,
    phone: staff.phone ?? "",
    permissions: staff.permissions,
    enabled: staff.enabled,
  };
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function getMyStaffProfile(actor: Actor) {
  const staff = await prisma.vendor_staff.findFirst({
    where: { user_id: actor.id, deleted_at: null, enabled: true },
    select: { permissions: true },
  });
  if (!staff) throw new AppError(404, "Staff profile not found or inactive");
  return { permissions: staff.permissions as string[] };
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
  const password = validatePassword(input.password, true)!;

  // Reject if another user already owns this email.
  const existing = await prisma.users.findUnique({ where: { email: data.email } });
  if (existing) throw new AppError(409, "A user with this email already exists");

  const [passwordHash, roleId] = await Promise.all([
    bcrypt.hash(password, 12),
    getVendorStaffRoleId(),
  ]);

  const staff = await prisma.$transaction(async (tx) => {
    const user = await tx.users.create({
      data: {
        full_name: data.name,
        email: data.email,
        phone: data.phone,
        password_hash: passwordHash,
        status: "active",
        must_change_password: true,
      },
    });

    await tx.user_roles.create({ data: { user_id: user.id, role_id: roleId } });

    const created = await tx.vendor_staff.create({
      data: {
        vendor_id: vendorId,
        user_id: user.id,
        created_by: actor.id,
        name: data.name,
        email: data.email,
        phone: data.phone,
        permissions: data.permissions,
        enabled: data.enabled,
      },
    });

    return mapStaff(created);
  });

  sendWelcomeEmail({ to: data.email, name: data.name, password }).catch(
    (err) => console.error("Staff welcome email failed:", err),
  );

  return staff;
}

export async function updateStaff(actor: Actor, id: string, input: StaffInput) {
  const vendorId = await resolveVendorId(actor);
  await assertOwnedStaff(vendorId, id);
  const data = validateInput(input);
  const newPassword = validatePassword(input.password, false);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.vendor_staff.findUnique({
      where: { id },
      select: { user_id: true, email: true },
    });

    if (existing?.user_id) {
      // Staff already has a linked user — update name/email/password as needed.
      const userUpdate: Record<string, unknown> = {
        full_name: data.name,
        phone: data.phone,
        updated_at: new Date(),
      };

      if (existing.email !== data.email) {
        const conflict = await tx.users.findUnique({ where: { email: data.email } });
        if (conflict && conflict.id !== existing.user_id) {
          throw new AppError(409, "A user with this email already exists");
        }
        userUpdate.email = data.email;
      }

      if (newPassword) {
        userUpdate.password_hash = await bcrypt.hash(newPassword, 12);
      }

      await tx.users.update({ where: { id: existing.user_id }, data: userUpdate });
    } else if (newPassword) {
      // Legacy staff with no user account — create one now so they can log in.
      const conflict = await tx.users.findUnique({ where: { email: data.email } });
      if (conflict) throw new AppError(409, "A user with this email already exists");

      const roleId = await getVendorStaffRoleId();
      const user = await tx.users.create({
        data: {
          full_name: data.name,
          email: data.email,
          phone: data.phone,
          password_hash: await bcrypt.hash(newPassword, 12),
          status: data.enabled ? "active" : "inactive",
        },
      });
      await tx.user_roles.create({ data: { user_id: user.id, role_id: roleId } });

      // Link the vendor_staff row to the new user before the rest of the update runs.
      await tx.vendor_staff.update({ where: { id }, data: { user_id: user.id } });
    }

    const staff = await tx.vendor_staff.update({
      where: { id },
      data: {
        name: data.name,
        email: data.email,
        phone: data.phone,
        permissions: data.permissions,
        enabled: data.enabled,
        updated_at: new Date(),
      },
    });

    return mapStaff(staff);
  });
}

// Toggling enabled also flips the linked user's login status so the account
// is immediately blocked at the auth layer, not just in the UI.
export async function setStaffEnabled(actor: Actor, id: string, enabled: boolean) {
  const vendorId = await resolveVendorId(actor);
  await assertOwnedStaff(vendorId, id);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.vendor_staff.findUnique({
      where: { id },
      select: { user_id: true },
    });

    if (existing?.user_id) {
      await tx.users.update({
        where: { id: existing.user_id },
        data: { status: enabled ? "active" : "inactive", updated_at: new Date() },
      });
    }

    const staff = await tx.vendor_staff.update({
      where: { id },
      data: { enabled, updated_at: new Date() },
    });

    return mapStaff(staff);
  });
}
