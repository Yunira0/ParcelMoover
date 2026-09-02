import { listManagedLocations } from './locations.service';
import type { ParcelStatus } from './orders.service';

/**
 * Branch Tracking data layer.
 *
 * A "branch" is an existing hub — a managed location with `isHub: true`. The
 * branch list is real (reuses GET /locations). Per-branch roll-up figures for
 * the Branch Overview / Branch Settlement cards are not wired yet: the
 * dashboard/COD-summary endpoints take no `hub` scope.
 *
 * TODO(backend, phase B/C): add `?hub=<id>` (or a from/to pair) to the summary
 * endpoints and add getBranchOverview()/getBranchSettlement() here.
 */

export interface Branch {
  id: string;
  name: string;
  code: string | null;
  district: string | null;
  isActive: boolean;
}

// ── Branch Overview metric cards ─────────────────────────────────────────────
// Mirrors merchantOverview.service's MERCHANT_METRIC_* — one card key, its
// label, its display order, and the parcel statuses it stands for (used to
// filter the waybill table when a card is clicked). Card counts themselves
// stay unwired until a hub-scoped summary endpoint exists.

export type BranchMetricKey =
  | 'totalOrders'
  | 'inTransit'
  | 'pendingDelivery'
  | 'totalDelivered'
  | 'returnProcessing'
  | 'returned'
  | 'hold'
  | 'failed'
  | 'deposited'
  | 'pendingDeposit';

export const BRANCH_METRIC_ORDER: BranchMetricKey[] = [
  'totalOrders',
  'inTransit',
  'pendingDelivery',
  'totalDelivered',
  'returnProcessing',
  'returned',
  'hold',
  'failed',
  'deposited',
  'pendingDeposit',
];

export const BRANCH_METRIC_LABELS: Record<BranchMetricKey, string> = {
  totalOrders: 'Total Orders',
  inTransit: 'In Transit',
  pendingDelivery: 'Pending Delivery',
  totalDelivered: 'Total Delivered',
  returnProcessing: 'Return Processing',
  returned: 'Returned',
  hold: 'Hold',
  failed: 'Failed',
  deposited: 'Deposited',
  pendingDeposit: 'Pending Deposit',
};

/** Statuses each card filters the table to. `totalOrders` = no filter.
 *  deposited / pendingDeposit are settlement states — both scope to delivered
 *  parcels here until a real settlement filter is wired. */
export const BRANCH_METRIC_STATUSES: Record<BranchMetricKey, ParcelStatus[] | undefined> = {
  totalOrders: undefined,
  inTransit: ['dispatched', 'oov'],
  pendingDelivery: ['arrived_at_branch', 'ready_to_deliver', 'sent_for_delivery', 'failed_delivery'],
  totalDelivered: ['delivered', 'partially_delivered'],
  returnProcessing: ['follow_up', 'ready_to_return', 'sent_to_vendor'],
  returned: ['returned_to_vendor'],
  hold: ['hold'],
  failed: ['failed_pickup', 'failed_delivery', 'loss_and_damage'],
  deposited: ['delivered', 'partially_delivered'],
  pendingDeposit: ['delivered', 'partially_delivered'],
};

const hubOnly = (name: string): string => name.split(' - ')[0];

export const listBranches = async (): Promise<Branch[]> => {
  const res = await listManagedLocations();
  return (res.data ?? [])
    .filter((loc) => loc.isHub)
    .map((loc) => ({
      id: loc.id,
      name: hubOnly(loc.name),
      code: loc.code,
      district: loc.district,
      isActive: loc.isActive,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
};
