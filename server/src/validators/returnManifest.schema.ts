import { z } from "zod";
import { paginationQuerySchema, uuidSchema, optionalUuidSchema } from "./common";
import { MAX_MANIFEST_PARCELS } from "../types/returnManifest.type";

export const RETURN_MANIFEST_STATUSES = ["open", "sent", "received"] as const;

const optionalRemarksSchema = z
  .string()
  .optional()
  .transform((val): string | undefined => val?.trim() || undefined)
  .pipe(z.string().max(500).optional());

export const listReturnManifestsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(RETURN_MANIFEST_STATUSES).optional(),
  vendorId: optionalUuidSchema,
  search: z.string().max(100).optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
});

export const openReturnManifestQuerySchema = z.object({
  vendorId: uuidSchema,
});

export const createReturnManifestSchema = z.object({
  vendorId: uuidSchema,
  remarks: optionalRemarksSchema,
});

export const addManifestParcelsSchema = z.object({
  // Capped at the same ceiling as manifest membership: a single call can never
  // legitimately carry more than a whole manifest's worth.
  parcelIds: z
    .array(uuidSchema, { error: "parcelIds is required" })
    .min(1, "parcelIds must be a non-empty array")
    .max(MAX_MANIFEST_PARCELS, `Cannot add more than ${MAX_MANIFEST_PARCELS} parcels at once`),
});

export const sendReturnManifestSchema = z.object({
  riderId: uuidSchema,
  remarks: optionalRemarksSchema,
});

export const receiveReturnManifestSchema = z.object({
  remarks: optionalRemarksSchema,
});
