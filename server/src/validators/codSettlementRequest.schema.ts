import { z } from "zod";
import { paginationQuerySchema, optionalUuidSchema } from "./common";

export const COD_SETTLEMENT_REQUEST_STATUSES = ["open", "in_progress", "settled", "rejected"] as const;

/** The states staff can move a live request into. */
export const COD_SETTLEMENT_REQUEST_ACTIONS = ["in_progress", "settled", "rejected"] as const;

// The note is all a vendor supplies. Bank details are read off their profile by
// the service, never accepted from the body — see createCodSettlementRequest for
// why. The three fields are still declared, and still ignored, so an older
// client that posts them gets a request rather than a validation error; `strip`
// (zod's default) drops them before they can reach anything.
export const createCodSettlementRequestSchema = z.object({
  bankName: z.string().trim().max(120).optional(),
  accountNumber: z.string().trim().max(34).optional(),
  accountName: z.string().trim().max(120).optional(),
  note: z
    .string()
    .optional()
    .transform((val): string | undefined => val?.trim() || undefined)
    .pipe(z.string().max(1000).optional()),
});

export type CreateCodSettlementRequestBody = z.infer<typeof createCodSettlementRequestSchema>;

export const updateCodSettlementRequestStatusSchema = z.object({
  status: z.enum(COD_SETTLEMENT_REQUEST_ACTIONS),
  decisionNote: z
    .string()
    .optional()
    .transform((val): string | undefined => val?.trim() || undefined)
    .pipe(z.string().max(1000).optional()),
  settlementId: optionalUuidSchema,
});

export const listCodSettlementRequestsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(COD_SETTLEMENT_REQUEST_STATUSES).optional(),
  search: z.string().max(100).optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
});
