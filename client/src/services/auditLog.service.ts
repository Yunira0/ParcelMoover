import api from '../utils/api';

export interface AuditLog {
  id: string;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  entityType: string;
  entityId: string | null;
  action: string;
  oldData: Record<string, unknown> | null;
  newData: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface AuditLogFilters {
  search?: string;
  entityType?: string;
  action?: string;
  fromDate?: string;
  toDate?: string;
  cursor?: string;
  pageSize?: number;
}

export interface AuditLogsPageMeta {
  pageSize: number;
  hasNextPage: boolean;
  nextCursor: string | null;
}

export const getAuditLogs = async (filters: AuditLogFilters = {}) => {
  const response = await api.get<{ success: boolean; data: AuditLog[]; meta: AuditLogsPageMeta }>(
    '/audit-logs',
    { params: filters },
  );
  return response.data;
};

export const getAuditLogFilterOptions = async () => {
  const response = await api.get<{ success: boolean; data: { entityTypes: string[]; actions: string[] } }>(
    '/audit-logs/filter-options',
  );
  return response.data;
};
