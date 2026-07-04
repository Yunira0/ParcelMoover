export type TicketStatus = "open" | "in_progress" | "pending" | "resolved" | "closed";

export type TicketWorkflowStatus = "open" | "pending" | "closed";

export interface CreateTicketInput {
  customerName?: string;
  customerPhone?: string;
  subject: string;
  category?: string;
  priority?: string;
  description?: string;
  status?: TicketStatus;
  assignedTo?: string;
  parcelId?: string;
}

export interface ListTicketsParams {
  status?: TicketStatus;
  search?: string;
  priority?: string;
  category?: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
  /** created_at is the only sortable column; defaults to "desc". */
  sortDir?: "asc" | "desc";
}
