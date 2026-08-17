import { z } from "zod";
import { paginationQuerySchema, optionalUuidSchema } from "./common";

export const COD_SETTLEMENT_REQUEST_STATUSES = ["open", "in_progress", "settled", "rejected"] as const;

/** The states staff can move a live request into. */
export const COD_SETTLEMENT_REQUEST_ACTIONS = ["in_progress", "settled", "rejected"] as const;

export const createCodSettlementRequestSchema = z.object({
  bankName: z.string().trim().min(2, "Bank name is required").max(120),
  // Kept as a string, not a number: account numbers carry meaningful leading
  // zeros and are long enough to lose precision as a float.
  accountNumber: z
    .string()
    .trim()
    .min(5, "Account number is required")
    .max(34, "Account number must not exceed 34 characters")
    .regex(/^[0-9A-Za-z-]+$/, "Account number may only contain letters, numbers and dashes"),
  accountName: z.string().trim().min(2, "Account holder name is required").max(120),
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
