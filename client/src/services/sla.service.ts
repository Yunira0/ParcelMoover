import api from '../utils/api';

// Per-status SLA thresholds (hours), keyed by parcel status plus the singleton
// 'remarks' and 'return' keys. null = SLA disabled for that key.
export type SlaSettings = Record<string, number | null>;

// Grouping for the settings screen. Keys mirror the parcel_status enum; the
// labels match ORDER_STATUS_LABELS (utils/orderStatus.ts).
export const SLA_GROUPS: { title: string; keys: { key: string; label: string }[] }[] = [
  {
    title: 'Pickup SLA',
    keys: [
      { key: 'pickup_ordered', label: 'Pickup Ordered' },
      { key: 'rider_assigned', label: 'Rider Assigned' },
      { key: 'picked_up', label: 'Picked Up' },
      { key: 'arrived', label: 'Arrived at Origin' },
    ],
  },
  {
    title: 'Delivery SLA',
    keys: [
      { key: 'ready_to_deliver', label: 'Ready to Deliver' },
      { key: 'sent_for_delivery', label: 'Sent for Delivery' },
    ],
  },
  {
    title: 'Transit SLA',
    keys: [
      { key: 'oov', label: 'Transit' },
      { key: 'dispatched', label: 'In Transit' },
      { key: 'arrived_at_branch', label: 'Arrived at Destination' },
    ],
  },
  {
    title: 'Return SLA',
    keys: [
      { key: 'follow_up', label: 'Follow Up' },
      { key: 'ready_to_return', label: 'Ready to Return' },
      { key: 'sent_to_vendor', label: 'Sent to Vendor' },
    ],
  },
  {
    title: 'Other',
    keys: [
      { key: 'remarks', label: 'Unclosed Remarks' },
    ],
  },
];

export const getSlaSettings = async (): Promise<{ success: boolean; data: SlaSettings }> => {
  const response = await api.get('/sla/settings');
  return response.data;
};

export const updateSlaSettings = async (data: SlaSettings) => {
  const response = await api.put('/sla/settings', data);
  return response.data;
};
