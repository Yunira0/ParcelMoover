export interface ListAuditLogsParams {
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
