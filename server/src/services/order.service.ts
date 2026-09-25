// Stable public entry point for order services. Internal modules import each other directly.
export { buildOrdersWhere } from "./orders/where";

export { invalidateOrderCaches } from "./orders/cache";

export { notifyAdmins, notifyVendorOfParcel } from "./orders/notifications";

export { createOrder } from "./orders/create";

export { updateOrderDetails } from "./orders/edit";

export { redirectOrder } from "./orders/redirect";

export { bulkCreateOrders } from "./orders/bulkCreate";

export {
  getOrderFilterOptions,
  getOrderCountsByStatus,
  listOrders,
  HANDOVER_PARCEL_INCLUDE,
  mapHandoverParcel,
  getRiderRunSheet,
} from "./orders/query-core";

export {
  getOrderByTrackingId,
  getPublicOrderTracking,
  getOrderStatusesByTrackingIds,
} from "./orders/query-detail";

export type {
  OrderFilterOptions,
  OrderCountsByStatus,
  OrderCountsByStatusFilters,
  ListOrdersResult,
  StatusTimestampMap,
  HandoverParcelDto,
} from "./orders/query-core";

export { updateParcelStatus } from "./orders/status-single";

export { bulkUpdateParcelStatus } from "./orders/status-bulk";

export type { BulkUpdateResult } from "./orders/status-bulk";

export { addOrderRemark } from "./orders/remarks";

export { getSenderProfile } from "./orders/senderProfile";

export { getStatusCounts, getMerchantOverview } from "./orders/operations-reporting";

export type { MerchantOverviewMetric, MerchantOverviewResult } from "./orders/operations-reporting";

export { getDashboardSummary } from "./orders/dashboard";

export { COD_DETAIL_BUCKETS, getCodSettlementDetail } from "./orders/cod-detail";

export type { CodDetailBucket, CodDetailRow } from "./orders/cod-detail";

export {
  applyExternalCarrierStatus,
  applyExternalCarrierFollowUp,
} from "./orders/status-carrier";

export type { CarrierStatusResult } from "./orders/status-carrier";

export {
  CANCELLED_TRASH_AFTER_DAYS,
  TRASH_RESTORE_STAGES,
  moveOrderToTrash,
  restoreOrderFromTrash,
  getPermanentDeleteBlocker,
  deleteOrderPermanently,
  sweepCancelledOrdersToTrash,
} from "./orders/trash";

export type { TrashRestoreStage } from "./orders/trash";

export { getMasterHubId, computeReturnCharge, resolveOrderOriginHub } from "./orders/pricing";

export type { OrderActor } from "./orders/types";
