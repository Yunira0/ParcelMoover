import api from '../utils/api';

export type TicketStatus = 'open' | 'pending' | 'closed';
export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TicketCategory = 'delivery' | 'cod_settlement' | 'pickup' | 'general';

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

export interface TicketThreadEntry {
  id: string;
  message: string;
  author: string;
  createdAt: string;
}

export interface TicketDetail extends Ticket {
  description: string;
  thread: TicketThreadEntry[];
}

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  open: 'Open',
  pending: 'Pending',
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
  cod_settlement: 'COD Settlement',
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

export const getTicketById = async (
  id: string,
): Promise<{ success: boolean; data: TicketDetail }> => {
  const response = await api.get(`/tickets/${id}`);
  return response.data;
};

export const replyToTicket = async (
  id: string,
  message: string,
): Promise<{ success: boolean; data: TicketDetail }> => {
  const response = await api.post(`/tickets/${id}/reply`, { message });
  return response.data;
};

export const setTicketStatus = async (
  id: string,
  status: TicketStatus,
): Promise<{ success: boolean; data: Ticket }> => {
  const response = await api.patch(`/tickets/${id}/status`, { status });
  return response.data;
};
