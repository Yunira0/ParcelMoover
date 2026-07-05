import React from 'react';
import { Package, CheckCircle, XCircle, AlertTriangle, Clock, Truck, MapPin, ArrowRight } from 'lucide-react';
import type { OrderStatusHistoryEntry, ParcelStatus } from '../../services/orders.service';
import { toBsDateLabel, toNptTime } from '../../utils/nepaliDate';

interface OrderTimelineProps {
  statusHistory: OrderStatusHistoryEntry[];
  currentStatus: ParcelStatus;
}

const TERMINAL_STATUSES: Set<ParcelStatus> = new Set([
  'delivered', 'cancelled', 'returned_to_vendor', 'loss_and_damage',
]);

const DANGER_STATUSES: Set<ParcelStatus> = new Set([
  'cancelled', 'loss_and_damage', 'failed_pickup', 'failed_delivery',
]);

const WARNING_STATUSES: Set<ParcelStatus> = new Set([
  'hold', 'oov', 'follow_up', 'ready_to_return',
]);

const STATUS_ICON: Record<string, React.FC<{ size?: number }>> = {
  pickup_ordered: Package,
  rider_assigned: Truck,
  picked_up: Package,
  arrived: MapPin,
  ready_to_deliver: CheckCircle,
  sent_for_delivery: Truck,
  oov: AlertTriangle,
  dispatched: ArrowRight,
  arrived_at_branch: MapPin,
  hold: Clock,
  loss_and_damage: XCircle,
  delivered: CheckCircle,
  failed_pickup: XCircle,
  failed_delivery: XCircle,
  cancelled: XCircle,
  follow_up: Clock,
  ready_to_return: AlertTriangle,
  sent_to_vendor: Truck,
  returned_to_vendor: Package,
};

const STATUS_LABEL: Record<ParcelStatus, string> = {
  pickup_ordered: 'Pickup Ordered',
  rider_assigned: 'Rider Assigned',
  picked_up: 'Picked Up',
  arrived: 'Arrived',
  ready_to_deliver: 'Ready to Deliver',
  sent_for_delivery: 'Out for Delivery',
  oov: 'Out of Volume',
  dispatched: 'Dispatched',
  arrived_at_branch: 'Arrived at Branch',
  hold: 'On Hold',
  loss_and_damage: 'Loss & Damage',
  delivered: 'Delivered',
  failed_pickup: 'Failed Pickup',
  failed_delivery: 'Failed Delivery',
  cancelled: 'Cancelled',
  follow_up: 'Follow Up',
  ready_to_return: 'Ready to Return',
  sent_to_vendor: 'Sent to Vendor',
  returned_to_vendor: 'Returned to Vendor',
};

function getTimelineClass(entry: OrderStatusHistoryEntry): string {
  if (TERMINAL_STATUSES.has(entry.newStatus)) return 'timeline-success';
  if (DANGER_STATUSES.has(entry.newStatus)) return 'timeline-danger';
  if (WARNING_STATUSES.has(entry.newStatus)) return 'timeline-warning';
  return 'timeline-active';
}

function formatTimelineTime(dateStr: string): string {
  if (!dateStr) return '';
  // Server sends date-only strings like "2024-01-15" (no time component)
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return toBsDateLabel(dateStr);
  }
  return `${toBsDateLabel(dateStr)}, ${toNptTime(dateStr)}`;
}

const OrderTimeline: React.FC<OrderTimelineProps> = ({ statusHistory }) => {
  if (!statusHistory.length) {
    return (
      <div className="od-empty">
        <div className="od-empty-icon">
          <Clock size={24} strokeWidth={1.5} />
        </div>
        <h3>No status history yet</h3>
        <p>Status updates will appear here as the parcel moves.</p>
      </div>
    );
  }

  return (
    <div className="od-timeline">
      {statusHistory.map((entry, idx) => {
        const isTerminal = TERMINAL_STATUSES.has(entry.newStatus);
        const isCurrent = idx === 0;
        const IconComponent = STATUS_ICON[entry.newStatus] || Package;

        return (
          <div
            key={entry.id}
            className={`od-timeline-item ${getTimelineClass(entry)}${isCurrent ? ' od-timeline-current' : ''}`}
          >
            <div className="od-timeline-connector">
              <div className={`od-timeline-dot${isTerminal || isCurrent ? ' od-timeline-dot-terminal' : ''}`}>
                <IconComponent size={14} />
              </div>
              {idx < statusHistory.length - 1 && <div className="od-timeline-line" />}
            </div>
            <div className="od-timeline-content">
              <div className="od-timeline-header">
                <span className="od-timeline-status">{STATUS_LABEL[entry.newStatus]}</span>
              </div>
              {entry.oldStatus && (
                <p className="od-timeline-from">from {STATUS_LABEL[entry.oldStatus]}</p>
              )}
              {entry.remarks && (
                <p className="od-timeline-remarks">{entry.remarks}</p>
              )}
              <div className="od-timeline-meta">
                <span className="od-timeline-by">{entry.changedBy}</span>
                <span className="od-timeline-dot-sep" />
                <span className="od-timeline-time">{formatTimelineTime(entry.createdAt)}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default OrderTimeline;
