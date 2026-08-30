import type { ParcelStatus } from '../services/orders.service';

/**
 * Where a failed order goes when it is put back into the workflow.
 *
 * An order can fail at two stages, and each has exactly one sensible way back:
 * a failed pickup returns to the pickup queue, a failed delivery returns to the
 * delivery queue. Both are already legal moves in the server's
 * STATUS_TRANSITIONS (failed_pickup -> pickup_ordered, failed_delivery ->
 * ready_to_deliver), so nothing here can request a transition the API refuses.
 *
 * This is a plain status update (updateOrderStatus), not a trash restore - it
 * operates on orders still live in the workflow, not trashed ones - so it isn't
 * constrained to TrashRestoreStage the way the Trash page's restore is.
 */
export const FAILED_RECOVERY_TARGET: Partial<Record<ParcelStatus, ParcelStatus>> = {
  failed_pickup: 'pickup_ordered',
  failed_delivery: 'ready_to_deliver',
};

/** Button/menu wording for the move, e.g. "Back to Pickup". */
export const FAILED_RECOVERY_LABEL: Partial<Record<ParcelStatus, string>> = {
  failed_pickup: 'Back to Pickup',
  failed_delivery: 'Back to Ready to Deliver',
};

export const recoveryTargetFor = (status: ParcelStatus): ParcelStatus | undefined =>
  FAILED_RECOVERY_TARGET[status];

export const isRecoverableFailure = (status: ParcelStatus): boolean =>
  status in FAILED_RECOVERY_TARGET;
