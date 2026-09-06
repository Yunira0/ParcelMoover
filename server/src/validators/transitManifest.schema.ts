import { z } from "zod";
import { paginationQuerySchema } from "./common";
import { MAX_TRANSIT_MANIFEST_PARCELS } from "../types/transitManifest.type";

export const TRANSIT_MANIFEST_STATUSES = ["open", "dispatched", "received"] as const;

const hubNameSchema = z
  .string()
  .trim()
  .min(1, "Hub name is required")
  .max(120, "Hub name must not exceed 120 characters");

const optionalRemarksSchema = z
  .string()
  .optional()
  .transform((val): string | undefined => val?.trim() || undefined)
  .pipe(z.string().max(500).optional());

const trackingIdsSchema = z
  .array(
    z.string().trim().min(1, "Tracking id must not be blank").max(40, "Tracking id is too long"),
    { error: "trackingIds is required" },
  )
  .min(1, "trackingIds must be a non-empty array")
  // Capped at the same ceiling as manifest membership: a single scan batch
  // can never legitimately carry more than a whole manifest's worth.
  .max(MAX_TRANSIT_MANIFEST_PARCELS, `Cannot scan more than ${MAX_TRANSIT_MANIFEST_PARCELS} parcels at once`);

export const listTransitManifestsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(TRANSIT_MANIFEST_STATUSES).optional(),
  search: z.string().max(100).optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
});

export const createTransitManifestSchema = z
  .object({
    fromHub: hubNameSchema,
    toHub: hubNameSchema,
    remarks: optionalRemarksSchema,
  })
  .refine((val) => val.fromHub !== val.toHub, {
    message: "Origin and destination must be different",
    path: ["toHub"],
  });

export const transitScanSchema = z.object({
  trackingIds: trackingIdsSchema,
});
