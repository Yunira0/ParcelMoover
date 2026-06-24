import api from '../utils/api';

export type TicketStatus = 'in_progress' | 'pending' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TicketCategory = 'delivery' | 'billing' | 'pickup' | 'general';

export interface Ticket {
  id: string;
  ticketId: string;
  customerName: string;
  customerPhone: string;
  subject: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  assignedTo: string;
  createdAt: string;
}

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  in_progress: 'In progress',
  pending: 'Pending',
  resolved: 'Resolved',
  closed: 'Closed',
};

export const TICKET_PRIORITY_LABELS: Record<TicketPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

export const TICKET_CATEGORY_LABELS: Record<TicketCategory, string> = {
  delivery: 'Delivery',
  billing: 'Billing',
  pickup: 'Pickup',
  general: 'General',
};

export interface ListTicketsParams {
  status?: TicketStatus;
  search?: string;
  priority?: TicketPriority;
  category?: TicketCategory;
  fromDate?: string;
  toDate?: string;
}

export interface TicketsListResponse {
  success: boolean;
  data: Ticket[];
}

export interface CreateTicketInput {
  customerName?: string;
  customerPhone?: string;
  subject: string;
  category?: TicketCategory;
  priority?: TicketPriority;
  description?: string;
  status?: TicketStatus;
}

export const getTickets = async (params?: ListTicketsParams): Promise<TicketsListResponse> => {
  const query: Record<string, string> = {};
  if (params?.status) query.status = params.status;
  if (params?.search) query.search = params.search;
  if (params?.priority) query.priority = params.priority;
  if (params?.category) query.category = params.category;
  if (params?.fromDate) query.fromDate = params.fromDate;
  if (params?.toDate) query.toDate = params.toDate;

  const response = await api.get('/tickets', { params: query });
  return response.data;
};

export const createTicket = async (
  data: CreateTicketInput,
): Promise<{ success: boolean; message: string; data: Ticket }> => {
  const response = await api.post('/tickets', data);
  return response.data;
};
