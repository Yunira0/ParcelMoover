import { z } from "zod";
import { isoDateStringSchema } from "./common";

// ── List audit logs (query params) ─────────────────────────────────────────
// Cursor (keyset) pagination only — no page/count, so this never runs an
// expensive COUNT(*) or OFFSET scan against an audit table with unbounded growth.

export const listAuditLogsQuerySchema = z.object({
  search: z.string().max(100).optional(),
  entityType: z.string().max(50).optional(),
  action: z.string().max(50).optional(),
  fromDate: isoDateStringSchema,
  toDate: isoDateStringSchema,
  cursor: z.string().max(200).optional(),
  pageSize: z.coerce
    .number()
    .int("pageSize must be an integer")
    .min(1, "pageSize must be at least 1")
    .max(50, "pageSize cannot exceed 50")
    .optional(),
});

export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;
