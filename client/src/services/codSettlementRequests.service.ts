import api from '../utils/api';

/**
 * A vendor's request to be paid out the COD the office is holding.
 *
 * `open` and `in_progress` are live — a vendor may hold only one across the two
 * at a time. `settled` and `rejected` are terminal and both release that hold,
 * so a rejected vendor can fix whatever was wrong and ask again.
 */
export type CodSettlementRequestStatus = 'open' | 'in_progress' | 'settled' | 'rejected';

export const COD_REQUEST_STATUS_LABELS: Record<CodSettlementRequestStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  settled: 'Settled',
  rejected: 'Rejected',
};

export const LIVE_COD_REQUEST_STATUSES: CodSettlementRequestStatus[] = ['open', 'in_progress'];

export const isLiveCodRequest = (status: CodSettlementRequestStatus) =>
  LIVE_COD_REQUEST_STATUSES.includes(status);

export interface CodSettlementRequest {
  id: string;
  requestNo: string;
  vendorId: string;
  vendorName: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  note: string;
  /** The vendor's balance when they asked. Context only — the real payable is recomputed at settlement. */
  amountSnapshot: number | null;
  status: CodSettlementRequestStatus;
  decisionNote: string;
  reviewedBy: string;
  reviewedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  settlementId: string | null;
  settlementStatementId: string | null;
  settlementStatus: string | null;
}

export interface ListCodSettlementRequestsParams {
  status?: CodSettlementRequestStatus;
  search?: string;
  page?: number;
  pageSize?: number;
  sortDir?: 'asc' | 'desc';
}

export interface CodSettlementRequestsListResponse {
  success: boolean;
  data: CodSettlementRequest[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface CreateCodSettlementRequestInput {
  bankName: string;
  accountNumber: string;
  accountName: string;
  note?: string;
}

export const getCodSettlementRequests = async (
  params?: ListCodSettlementRequestsParams,
): Promise<CodSettlementRequestsListResponse> => {
  const query: Record<string, string> = {};
  if (params?.status) query.status = params.status;
  if (params?.search) query.search = params.search;
  if (params?.page) query.page = String(params.page);
  if (params?.pageSize) query.pageSize = String(params.pageSize);
  if (params?.sortDir) query.sortDir = params.sortDir;

  const response = await api.get('/cod-settlement-requests', { params: query });
  return response.data;
};

/** The account the vendor registered with, used to prefill the request form. */
export interface RegisteredBankDetails {
  bankName: string;
  accountNumber: string;
  accountName: string;
}

export const getRegisteredBankDetails = async (): Promise<{
  success: boolean;
  data: RegisteredBankDetails;
}> => {
  const response = await api.get('/cod-settlement-requests/registered-bank');
  return response.data;
};

export const getCodSettlementRequestById = async (
  id: string,
): Promise<{ success: boolean; data: CodSettlementRequest }> => {
  const response = await api.get(`/cod-settlement-requests/${id}`);
  return response.data;
};

/** Rejected with 409 when the vendor already holds a live request. */
export const createCodSettlementRequest = async (
  data: CreateCodSettlementRequestInput,
): Promise<{ success: boolean; message: string; data: CodSettlementRequest }> => {
  const response = await api.post('/cod-settlement-requests', data);
  return response.data;
};

export const updateCodSettlementRequestStatus = async (
  id: string,
  data: { status: 'in_progress' | 'settled' | 'rejected'; decisionNote?: string; settlementId?: string },
): Promise<{ success: boolean; message: string; data: CodSettlementRequest }> => {
  const response = await api.patch(`/cod-settlement-requests/${id}/status`, data);
  return response.data;
};
