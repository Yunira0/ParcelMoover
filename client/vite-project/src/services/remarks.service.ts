import api from '../utils/api';

export type RemarkStatus = 'open' | 'pending' | 'closed';

export const REMARK_STATUS_LABELS: Record<RemarkStatus, string> = {
  open: 'Open',
  pending: 'Pending',
  closed: 'Closed',
};

export interface Remark {
  id: string;
  remarkId: string;
  trackingId: string;
  customerName: string;
  customerPhone: string;
  subject: string;
  status: RemarkStatus;
  addedBy: string;
  createdAt: string;
}

export interface ListRemarksParams {
  status?: RemarkStatus;
  search?: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
}

export interface RemarksPageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface RemarksListResponse {
  success: boolean;
  data: Remark[];
  meta?: RemarksPageMeta;
}

export interface RemarkThreadEntry {
  id: string;
  remark: string;
  addedBy: string;
  createdAt: string;
  parentRemarkId: string | null;
  parentAuthor: string | null;
  parentSnippet: string | null;
}

export interface RemarkDetail {
  id: string;
  remarkId: string;
  parcelId: string;
  trackingId: string;
  status: RemarkStatus;
  senderName: string;
  senderPhone: string;
  receiverName: string;
  receiverPhone: string;
  thread: RemarkThreadEntry[];
}

export const getRemarks = async (params?: ListRemarksParams): Promise<RemarksListResponse> => {
  const query: Record<string, string> = {};
  if (params?.status) query.status = params.status;
  if (params?.search) query.search = params.search;
  if (params?.fromDate) query.fromDate = params.fromDate;
  if (params?.toDate) query.toDate = params.toDate;
  if (params?.page !== undefined) query.page = String(params.page);
  if (params?.pageSize !== undefined) query.pageSize = String(params.pageSize);

  const response = await api.get('/remarks', { params: query });
  return response.data;
};

export const getRemarkById = async (id: string): Promise<{ success: boolean; data: RemarkDetail }> => {
  const response = await api.get(`/remarks/${id}`);
  return response.data;
};

export const setRemarkStatus = async (
  id: string,
  status: RemarkStatus,
): Promise<{ success: boolean; data: { id: string; status: RemarkStatus } }> => {
  const response = await api.patch(`/remarks/${id}/status`, { status });
  return response.data;
};

export const getUnclosedRemarksCount = async (): Promise<{ success: boolean; data: { count: number } }> => {
  const response = await api.get('/remarks/unclosed/count');
  return response.data;
};
