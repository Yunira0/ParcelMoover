import { z } from "zod";
import { paginationQuerySchema, optionalUuidSchema, isoDateStringSchema } from "./common";

// ── Enums ─────────────────────────────────────────────────────────────────────

export const TICKET_STATUSES = ["open", "in_progress", "pending", "resolved", "closed"] as const;
export const TICKET_PRIORITIES = ["low", "medium", "high", "urgent"] as const;

// ── Create ticket ─────────────────────────────────────────────────────────────

const optionalTicketString = (maxLen: number) =>
  z
    .string()
    .optional()
    .transform((val): string | undefined => {
      const t = val?.trim();
      return t || undefined;
    })
    .pipe(z.string().max(maxLen).optional());

const optionalTicketPhone = z
  .string()
  .optional()
  .transform((val): string | undefined => {
    const t = val?.trim();
    return t || undefined;
  })
  .pipe(z.string().regex(/^\+?[0-9]{10,15}$/, "Invalid phone number format").optional());

export const createTicketSchema = z.object({
  subject: z
    .string()
    .trim()
    .min(3, "Subject must be at least 3 characters")
    .max(200, "Subject must not exceed 200 characters"),
  customerName: optionalTicketString(100),
  customerPhone: optionalTicketPhone,
  category: optionalTicketString(50),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  description: optionalTicketString(2000),
  status: z.enum(TICKET_STATUSES).optional(),
  assignedTo: optionalUuidSchema,
  parcelId: optionalUuidSchema,
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;

// ── List tickets (query params) ───────────────────────────────────────────────

export const listTicketsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(TICKET_STATUSES).optional(),
  search: z.string().max(100).optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  category: z.string().max(50).optional(),
  fromDate: isoDateStringSchema,
  toDate: isoDateStringSchema,
});

export type ListTicketsQuery = z.infer<typeof listTicketsQuerySchema>;
