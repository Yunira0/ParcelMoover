/**
 * Vendor-facing status labels for the Partner API.
 *
 * Internal operational statuses (like "oov", "dispatched", "follow_up") are
 * replaced with simple, vendor-friendly labels that hide internal process
 * details. This is the single source of truth for Partner API responses.
 */

const VENDOR_STATUS_LABELS: Record<string, string> = {
  pickup_ordered: "Order Placed",
  rider_assigned: "Pickup Scheduled",
  picked_up: "Picked Up",
  arrived: "On the Way",
  ready_to_deliver: "On the Way",
  sent_for_delivery: "Out for Delivery",
  oov: "On the Way",
  dispatched: "On the Way",
  arrived_at_branch: "On the Way",
  hold: "On Hold",
  loss_and_damage: "Delayed",
  delivered: "Delivered",
  partially_delivered: "Partially Delivered",
  failed_pickup: "Pickup Failed",
  failed_delivery: "Delivery Failed",
  cancelled: "Cancelled",
  follow_up: "Under Review",
  ready_to_return: "Return in Progress",
  sent_to_vendor: "Return in Progress",
  returned_to_vendor: "Returned to Sender",
};

/**
 * Returns a vendor-friendly label for the given internal status code.
 * Falls back to the raw status if no mapping exists.
 */
export function getVendorStatusLabel(status: string): string {
  return VENDOR_STATUS_LABELS[status] || status;
}
