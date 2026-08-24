   import type { StatusChipTone } from '../components/StatusChip';
import type { ParcelStatus } from '../services/orders.service';
import { toBsDateTimeCell } from './nepaliDate';

// Canonical parcel-status display labels and chip tones for read-only surfaces
// (dashboard, reports). Mirrors the mapping the Order Management screen uses so
// a status reads identically everywhere it appears.
export const ORDER_STATUS_LABELS: Record<ParcelStatus, string> = {
  pickup_ordered: 'Pickup Ordered',
  rider_assigned: 'Rider Assigned',
  picked_up: 'Picked Up',
  arrived: 'Arrived at Origin',
  ready_to_deliver: 'Ready to Deliver',
  sent_for_delivery: 'Sent for Delivery',
  oov: 'Transit',
  dispatched: 'In Transit',
  arrived_at_branch: 'Arrived at Destination',
  hold: 'On Hold',
  loss_and_damage: 'Loss & Damage',
  delivered: 'Delivered',
  partially_delivered: 'Partially Delivered',
  failed_pickup: 'Failed Pickup',
  failed_delivery: 'Failed Delivery',
  cancelled: 'Cancelled',
  follow_up: 'Follow Up',
  ready_to_return: 'Ready to Return',
  sent_to_vendor: 'Sent to Vendor',
  returned_to_vendor: 'Returned to Vendor',
};

export const getOrderStatusTone = (status: ParcelStatus): StatusChipTone => {
  if (status === 'delivered' || status === 'returned_to_vendor') return 'success';
  if (status === 'partially_delivered') return 'warning';
  if (['arrived', 'arrived_at_branch', 'rider_assigned'].includes(status)) return 'info';
  if (['failed_pickup', 'failed_delivery', 'loss_and_damage'].includes(status)) return 'danger';
  if (status === 'cancelled') return 'neutral';
  return 'warning';
};

// ── Export: one "when did it reach this stage" column per status ─────────────

// Lifecycle order, not enum order: the columns read left-to-right as the parcel
// actually moves, so a reader can scan a row and see where it stalled. Every
// status appears, including the terminal ones a given parcel never reaches -
// a stable column set matters more in a spreadsheet than a compact one, since
// sheets from different tabs get compared and merged.
export const STATUS_TIMELINE_ORDER: ParcelStatus[] = [
  'pickup_ordered',
  'rider_assigned',
  'picked_up',
  'arrived',
  'oov',
  'dispatched',
  'arrived_at_branch',
  'ready_to_deliver',
  'sent_for_delivery',
  'delivered',
  'partially_delivered',
  'hold',
  'failed_pickup',
  'failed_delivery',
  'loss_and_damage',
  'follow_up',
  'ready_to_return',
  'sent_to_vendor',
  'returned_to_vendor',
  'cancelled',
];

/** Header cells for the per-status timestamp columns, e.g. "Sent for Delivery At". */
export const STATUS_TIMELINE_HEADERS = STATUS_TIMELINE_ORDER.map(
  status => `${ORDER_STATUS_LABELS[status]} At`,
);

/**
 * The matching row cells, in the same order as STATUS_TIMELINE_HEADERS.
 * Blank for any stage the parcel has not reached.
 */
export const statusTimelineCells = (
  timestamps?: Partial<Record<ParcelStatus, string>>,
): string[] =>
  STATUS_TIMELINE_ORDER.map(status => (timestamps?.[status] ? toBsDateTimeCell(timestamps[status]) : ''));
