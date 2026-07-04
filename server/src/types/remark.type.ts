export interface ListRemarksParams {
  search?: string;
  status?: string;
  /** True selects both "open" and "pending" (any non-closed remark). Takes precedence over `status`. */
  unclosed?: boolean;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
  /** created_at is the only sortable column; defaults to "desc". */
  sortDir?: "asc" | "desc";
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
