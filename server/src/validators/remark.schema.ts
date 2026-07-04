import { z } from "zod";
import { isoDateStringSchema } from "./common";

// ── List remarks (query params) ───────────────────────────────────────────────

export const listRemarksQuerySchema = z.object({
  status: z.string().max(50).optional(),
  search: z.string().max(100).optional(),
  fromDate: isoDateStringSchema,
  toDate: isoDateStringSchema,
});

export type ListRemarksQuery = z.infer<typeof listRemarksQuerySchema>;
