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
}

export interface RemarksListResponse {
  success: boolean;
  data: Remark[];
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
