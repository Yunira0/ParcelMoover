import type { ParcelStatus } from '../services/orders.service';
import type { StatusChipTone } from '../components/StatusChip';

// Customer-facing labels for the public tracker - deliberately coarser than
// the internal ops status labels used in dashboard tables. A vendor's
// customer tracking a parcel doesn't need to know it's "OOV" or "Sent to
// Vendor"; internal process nouns shouldn't leak to the public.
const PUBLIC_STATUS_LABELS: Record<ParcelStatus, string> = {
  pickup_ordered: 'Order placed',
  rider_assigned: 'Pickup scheduled',
  picked_up: 'Picked up',
  arrived: 'In transit',
  ready_to_deliver: 'In transit',
  sent_for_delivery: 'Out for delivery',
  oov: 'In transit',
  dispatched: 'In transit',
  arrived_at_branch: 'In transit',
  hold: 'On hold',
  loss_and_damage: 'Delayed — contact support',
  delivered: 'Delivered',
  partially_delivered: 'Partially delivered',
  failed_pickup: 'Pickup attempt failed',
  failed_delivery: 'Delivery attempt failed',
  cancelled: 'Cancelled',
  follow_up: 'In progress',
  ready_to_return: 'Being returned',
  sent_to_vendor: 'Being returned',
  returned_to_vendor: 'Returned to sender',
};

const PUBLIC_STATUS_TONES: Record<ParcelStatus, StatusChipTone> = {
  pickup_ordered: 'neutral',
  rider_assigned: 'info',
  picked_up: 'info',
  arrived: 'info',
  ready_to_deliver: 'info',
  sent_for_delivery: 'info',
  oov: 'info',
  dispatched: 'info',
  arrived_at_branch: 'info',
  hold: 'warning',
  loss_and_damage: 'warning',
  delivered: 'success',
  partially_delivered: 'warning',
  failed_pickup: 'danger',
  failed_delivery: 'danger',
  cancelled: 'neutral',
  follow_up: 'warning',
  ready_to_return: 'warning',
  sent_to_vendor: 'warning',
  returned_to_vendor: 'neutral',
};

export function getPublicStatusLabel(status: ParcelStatus): string {
  return PUBLIC_STATUS_LABELS[status] || status;
}

export function getPublicStatusTone(status: ParcelStatus): StatusChipTone {
  return PUBLIC_STATUS_TONES[status] || 'neutral';
}
