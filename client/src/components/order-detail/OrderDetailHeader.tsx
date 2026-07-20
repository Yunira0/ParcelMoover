import React, { useRef, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Copy, Check, Printer } from 'lucide-react';
import StatusChip from '../StatusChip';
import type { StatusChipTone } from '../StatusChip';
import type { ParcelStatus, OrderType, ServiceType } from '../../services/orders.service';
import { toBsDateLabel, toNptTime } from '../../utils/nepaliDate';

interface OrderDetailHeaderProps {
  trackingId: string;
  orderNumber: number;
  status: ParcelStatus;
  orderType: OrderType;
  serviceType: ServiceType;
  createdAt: string;
  orderId: string;
  onPrint: () => void;
}

const STATUS_TONE_MAP: Record<ParcelStatus, StatusChipTone> = {
  pickup_ordered: 'info',
  rider_assigned: 'info',
  picked_up: 'info',
  arrived: 'info',
  ready_to_deliver: 'info',
  sent_for_delivery: 'info',
  oov: 'warning',
  dispatched: 'info',
  arrived_at_branch: 'info',
  hold: 'warning',
  loss_and_damage: 'danger',
  delivered: 'success',
  partially_delivered: 'warning',
  failed_pickup: 'danger',
  failed_delivery: 'danger',
  cancelled: 'danger',
  follow_up: 'warning',
  ready_to_return: 'warning',
  sent_to_vendor: 'info',
  returned_to_vendor: 'neutral',
};

export const STATUS_LABEL: Record<ParcelStatus, string> = {
  pickup_ordered: 'Pickup Ordered',
  rider_assigned: 'Rider Assigned',
  picked_up: 'Picked Up',
  arrived: 'Arrived at Origin',
  ready_to_deliver: 'Ready to Deliver',
  sent_for_delivery: 'Sent for Delivery',
  oov: 'Out of Valley',
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

const ORDER_TYPE_LABEL: Record<OrderType, string> = {
  delivery: 'Delivery',
  exchange: 'Exchange',
  return: 'Return',
};

const SERVICE_TYPE_LABEL: Record<ServiceType, string> = {
  home_delivery: 'Home Delivery',
  branch_delivery: 'Branch Delivery',
};

const OrderDetailHeader: React.FC<OrderDetailHeaderProps> = ({
  trackingId,
  orderNumber,
  status,
  orderType,
  serviceType,
  createdAt,
  onPrint,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, trackingId, {
        width: 56,
        margin: 0,
        color: { dark: '#030712', light: '#ffffff' },
      });
    }
  }, [trackingId]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(trackingId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const input = document.createElement('input');
      input.value = trackingId;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const formattedDate = toBsDateLabel(createdAt);
  const formattedTime = toNptTime(createdAt);

  return (
    <div className="od-header">
      <div className="od-header-left">
        <div className="od-header-top-row">
          <div className="od-header-ids">
            <h1 className="od-tracking-id">{trackingId}</h1>
            <button
              className="od-copy-btn"
              onClick={handleCopy}
              title="Copy tracking ID"
              aria-label="Copy tracking ID"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied && <span className="od-copy-tooltip">Copied!</span>}
            </button>
          </div>
          <StatusChip tone={STATUS_TONE_MAP[status]} variant="solid">
            {STATUS_LABEL[status]}
          </StatusChip>
        </div>

        <div className="od-header-details">
          <span className="od-detail-pill">
            <span className="od-detail-label">Order</span>
            <span className="od-detail-value">#{orderNumber}</span>
          </span>
          <span className="od-detail-pill">
            <span className="od-detail-label">Type</span>
            <span className="od-detail-value">{ORDER_TYPE_LABEL[orderType]}</span>
          </span>
          <span className="od-detail-pill">
            <span className="od-detail-label">Service</span>
            <span className="od-detail-value">{SERVICE_TYPE_LABEL[serviceType]}</span>
          </span>
          <span className="od-detail-pill">
            <span className="od-detail-label">Created</span>
            <span className="od-detail-value">{formattedDate}, {formattedTime}</span>
          </span>
        </div>
      </div>

      <div className="od-header-right">
        <div className="od-qr-box">
          <canvas ref={canvasRef} className="od-qr-canvas" />
          <span className="od-qr-label">Scan to track</span>
        </div>
        <button
          className="od-action-btn"
          onClick={onPrint}
          title="Print label"
          aria-label="Print label"
        >
          <Printer size={15} />
        </button>
      </div>
    </div>
  );
};

export default OrderDetailHeader;
