/**
 * Which author group an "unclosed comments" view covers. Vendor owners and their
 * staff are one group; riders are the other. Omitted means both, which is what
 * the nav badge's grand total counts.
 */
export type RemarkAuthorGroup = "vendor" | "rider";

export interface ListRemarksParams {
  search?: string;
  status?: string;
  /** True selects any non-closed remark. Takes precedence over `status`. */
  unclosed?: boolean;
  /** Only meaningful alongside `unclosed`; narrows to one author group. */
  author?: RemarkAuthorGroup;
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
