/**
 * A vendor's request to be paid out the COD the office is holding for them.
 *
 * `open` and `in_progress` are live; a vendor may hold only one request across
 * the two at a time. `settled` and `rejected` are terminal and both release
 * that hold - see the partial unique index in
 * 20260817140000_add_cod_settlement_requests.
 */
export type CodSettlementRequestStatus = "open" | "in_progress" | "settled" | "rejected";

/** The states that block a vendor from raising another request. */
export const LIVE_REQUEST_STATUSES: CodSettlementRequestStatus[] = ["open", "in_progress"];

export interface CreateCodSettlementRequestInput {
  bankName: string;
  accountNumber: string;
  accountName: string;
  note?: string;
}

export interface UpdateCodSettlementRequestStatusInput {
  status: CodSettlementRequestStatus;
  /** Required when rejecting - the vendor is told why, so they can re-raise. */
  decisionNote?: string;
  /** Links the request to the payout that answered it, when settling. */
  settlementId?: string;
}

export interface ListCodSettlementRequestsParams {
  status?: CodSettlementRequestStatus;
  search?: string;
  page?: number;
  pageSize?: number;
  sortDir?: "asc" | "desc";
}
