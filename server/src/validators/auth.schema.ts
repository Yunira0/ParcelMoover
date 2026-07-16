import { z } from "zod";
import {
  nameSchema,
  phoneSchema,
  emailSchema,
  requiredEmailSchema,
  passwordSchema,
  optionalUuidSchema,
} from "./common";
import { ADMIN_PERMISSIONS } from "../types/adminPermission.type";

// ── Login ─────────────────────────────────────────────────────────────────────

export const loginSchema = z.object({
  email: requiredEmailSchema,
  password: z.string().min(1, "Password is required"),
});

export type LoginInput = z.infer<typeof loginSchema>;

// ── Register managed user (admin / vendor / rider) ───────────────────────────

const MANAGED_USER_TYPES = ["admin", "vendor", "rider"] as const;

// Optional string: empty/whitespace → undefined; otherwise trim and enforce max length.
const optionalAuthString = (maxLen: number, customMsg?: string) =>
  z
    .string()
    .optional()
    .transform((val): string | undefined => {
      const t = val?.trim();
      return t || undefined;
    })
    .pipe(z.string().max(maxLen, customMsg).optional());

// Optional string with a minimum length (e.g. clientName must be ≥ 2 chars).
const optionalMinMaxString = (minLen: number, maxLen: number) =>
  z
    .string()
    .optional()
    .transform((val): string | undefined => {
      const t = val?.trim();
      return t || undefined;
    })
    .pipe(z.string().min(minLen).max(maxLen).optional());

export const registerUserSchema = z
  .object({
    type: z.enum(MANAGED_USER_TYPES, {
      error: `type must be one of: ${MANAGED_USER_TYPES.join(", ")}`,
    }),
    fullName: nameSchema,
    email: requiredEmailSchema,
    phone: phoneSchema,
    password: passwordSchema,
    locationId: optionalUuidSchema,
    joinedAt: z
      .union([
        z.literal("").transform(() => undefined),
        z.string().transform((val) => {
          if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return `${val}T00:00:00Z`;
          return val;
        }).pipe(z.string().datetime({ offset: true })),
        z.undefined(),
      ])
      .optional(),
    // Shared profile / bank fields
    pan: optionalAuthString(50),
    citizenshipNo: optionalAuthString(50),
    bankName: optionalAuthString(100),
    bankAccountNo: optionalAuthString(50),
    bankAccountHolder: optionalAuthString(100),
    // admin-only
    position: optionalAuthString(100, "Position must not exceed 100 characters"),
    department: optionalAuthString(100),
    idDocumentType: optionalAuthString(50),
    idDocumentNumber: optionalAuthString(100),
    fatherName: optionalAuthString(100),
    motherName: optionalAuthString(100),
    grandfatherName: optionalAuthString(100),
    permanentAddress: optionalAuthString(255),
    currentAddress: optionalAuthString(255),
    experience: optionalAuthString(255),
    // vendor-only
    clientName: optionalMinMaxString(2, 100),
    address: optionalAuthString(255),
    businessName: optionalAuthString(100),
    sales: optionalAuthString(100),
    salesUserId: optionalUuidSchema,
    rateType: optionalAuthString(30),
    flatInsideValley: optionalAuthString(20),
    flatOutsideValley: optionalAuthString(20),
    zoneMajorCities: optionalAuthString(20),
    zoneUrbanAreas: optionalAuthString(20),
    zoneRemoteAreas: optionalAuthString(20),
    zoneInsideValley: optionalAuthString(20),
    insideValleyFlatRate: optionalAuthString(20),
    extraWeightPercent: optionalAuthString(20),
    returnInsideValleyPercent: optionalAuthString(20),
    returnOutsideValleyPercent: optionalAuthString(20),
    branchFlatInsideValley: optionalAuthString(20),
    branchFlatOutsideValley: optionalAuthString(20),
    branchZoneMajorCities: optionalAuthString(20),
    branchZoneUrbanAreas: optionalAuthString(20),
    branchZoneRemoteAreas: optionalAuthString(20),
    branchZoneInsideValley: optionalAuthString(20),
    pickupLandmark: optionalAuthString(255),
    billingBusinessName: optionalAuthString(100),
    registrationNo: optionalAuthString(100),
    panVatNo: optionalAuthString(50),
    // rider-only
    riderLocation: optionalAuthString(255),
    licenceNo: optionalAuthString(50),
    vehicleNo: optionalAuthString(50),
    salaryCommission: optionalAuthString(100),
  })
  .superRefine((data, ctx) => {
    if (data.type === "vendor" && !data.clientName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["clientName"],
        message: "clientName is required for vendor registration",
      });
    }
  });

export type RegisterUserInput = z.infer<typeof registerUserSchema>;

// ── Update managed user profile ───────────────────────────────────────────────

const optionalAlternatePhone = z
  .string()
  .optional()
  .transform((val): string | undefined => {
    const t = val?.trim();
    return t || undefined;
  })
  .pipe(
    z.string().regex(/^\+?[0-9]{10,15}$/, "Alternate phone must be 10–15 digits").optional(),
  );

export const updateManagedUserSchema = z.object({
  fullName: nameSchema.optional(),
  email: emailSchema,
  phone: phoneSchema.optional(),
  locationId: optionalUuidSchema,
  joinedAt: z
    .union([
      z.literal("").transform(() => undefined),
      z.string().transform((val) => {
        if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return `${val}T00:00:00Z`;
        return val;
      }).pipe(z.string().datetime({ offset: true })),
      z.undefined(),
    ])
    .optional(),
  // Must match the DB user_status enum (active | inactive) - Prisma rejects other values.
  status: z.enum(["active", "inactive"]).optional(),
  // Shared profile / bank fields
  pan: optionalAuthString(50),
  citizenshipNo: optionalAuthString(50),
  bankName: optionalAuthString(100),
  bankAccountNo: optionalAuthString(50),
  bankAccountHolder: optionalAuthString(100),
  // admin-only
  position: optionalAuthString(100),
  department: optionalAuthString(100),
  idDocumentType: optionalAuthString(50),
  idDocumentNumber: optionalAuthString(100),
  fatherName: optionalAuthString(100),
  motherName: optionalAuthString(100),
  grandfatherName: optionalAuthString(100),
  permanentAddress: optionalAuthString(255),
  currentAddress: optionalAuthString(255),
  experience: optionalAuthString(255),
  // vendor-only
  clientName: optionalMinMaxString(2, 100),
  address: optionalAuthString(255),
  businessName: optionalAuthString(100),
  sales: optionalAuthString(100),
  salesUserId: optionalUuidSchema,
  rateType: optionalAuthString(30),
  flatInsideValley: optionalAuthString(20),
  flatOutsideValley: optionalAuthString(20),
  zoneMajorCities: optionalAuthString(20),
  zoneUrbanAreas: optionalAuthString(20),
  zoneRemoteAreas: optionalAuthString(20),
  zoneInsideValley: optionalAuthString(20),
  insideValleyFlatRate: optionalAuthString(20),
  extraWeightPercent: optionalAuthString(20),
  pickupLandmark: optionalAuthString(255),
  billingBusinessName: optionalAuthString(100),
  registrationNo: optionalAuthString(100),
  panVatNo: optionalAuthString(50),
  alternatePhone: optionalAlternatePhone,
  // rider-only
  riderLocation: optionalAuthString(255),
  licenceNo: optionalAuthString(50),
  vehicleNo: optionalAuthString(50),
  salaryCommission: optionalAuthString(100),
});

export type UpdateManagedUserInput = z.infer<typeof updateManagedUserSchema>;

// ── Update password ───────────────────────────────────────────────────────────

export const updatePasswordSchema = z.object({
  password: passwordSchema,
});

export type UpdatePasswordInput = z.infer<typeof updatePasswordSchema>;

// ── Delegated admin permissions ───────────────────────────────────────────────

export const updateAdminPermissionsSchema = z.object({
  permissions: z.array(z.enum(ADMIN_PERMISSIONS)).max(10),
});

export type UpdateAdminPermissionsInput = z.infer<typeof updateAdminPermissionsSchema>;

// ── Super admin role grant ────────────────────────────────────────────────────

export const updateAdminRoleSchema = z.object({
  superAdmin: z.boolean(),
});

export type UpdateAdminRoleInput = z.infer<typeof updateAdminRoleSchema>;
