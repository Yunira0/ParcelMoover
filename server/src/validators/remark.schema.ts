import { z } from "zod";
import { isoDateStringSchema, paginationQuerySchema } from "./common";

// ── List remarks (query params) ───────────────────────────────────────────────
// validate() replaces req.query with the parsed result, and zod strips keys the
// schema doesn't declare - so every param the controller reads has to be listed
// here or it never reaches it.

export const listRemarksQuerySchema = paginationQuerySchema.extend({
  status: z.string().max(50).optional(),
  // Sent as the string "true"; kept as a string so the controller's
  // `unclosed === "true"` check stays the one place that decides the flag.
  unclosed: z.enum(["true", "false"]).optional(),
  // Narrows the unclosed view to one author group; omitted means both.
  author: z.enum(["vendor", "rider"]).optional(),
  search: z.string().max(100).optional(),
  fromDate: isoDateStringSchema,
  toDate: isoDateStringSchema,
  sortDir: z.enum(["asc", "desc"]).optional(),
});

export type ListRemarksQuery = z.infer<typeof listRemarksQuerySchema>;
