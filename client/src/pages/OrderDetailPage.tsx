import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Package, ShieldAlert } from 'lucide-react';
import {
  getOrderByTrackingId,
  addOrderRemark,
  subscribeToOrderStatusChanged,
  updateOrderStatus,
  type OrderDetail,
  type OrderRemark,
  type ParcelStatus,
} from '../services/orders.service';
import OrderDetailHeader, { STATUS_LABEL } from '../components/order-detail/OrderDetailHeader';
import { getCurrentUserRoles } from '../utils/auth';
import OrderInfoCards from '../components/order-detail/OrderInfoCards';
import OrderTimeline from '../components/order-detail/OrderTimeline';
import OrderRemarks from '../components/order-detail/OrderRemarks';
import OrderRemarkInput from '../components/order-detail/OrderRemarkInput';
import OrderPriceLog from '../components/order-detail/OrderPriceLog';
import { printLabels } from '../utils/printLabels';
import './OrderDetailPage.css';

// Statuses whose transition needs structured extra data (a rider pick, COD
// amounts, a destination hub) - those keep their dedicated ops flows and are
// left out of the raw super_admin override dropdown.
const OVERRIDE_EXCLUDED: ParcelStatus[] = [
  'rider_assigned',
  'sent_for_delivery',
  'partially_delivered',
];

const OrderDetailPage: React.FC = () => {
  const { trackingId } = useParams<{ trackingId: string }>();
  const navigate = useNavigate();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<OrderRemark | null>(null);
  const [highlightedRemarkId, setHighlightedRemarkId] = useState<string | null>(null);
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
    };
  }, []);

  // super_admin only: force the parcel into any status, ignoring the
  // transition map (the server grants the same bypass to super_admin actors).
  const isSuperAdmin = getCurrentUserRoles().includes('super_admin');
  const [overrideStatus, setOverrideStatus] = useState<ParcelStatus | ''>('');
  const [overrideRemarks, setOverrideRemarks] = useState('');
  const [overrideSaving, setOverrideSaving] = useState(false);
  const [overrideError, setOverrideError] = useState('');

  const fetchOrder = useCallback(async () => {
    if (!trackingId) return;
    try {
      setLoading(true);
      setError(null);
      const response = await getOrderByTrackingId(trackingId);
      if (response.success) {
        setOrder(response.data);
      } else {
        setError('Order not found.');
      }
    } catch {
      setError('Failed to load order details. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [trackingId]);

  useEffect(() => {
    fetchOrder();
  }, [fetchOrder]);

  useEffect(() => {
    const unsubscribe = subscribeToOrderStatusChanged(() => {
      fetchOrder();
    });
    return unsubscribe;
  }, [fetchOrder]);

  const handleAddRemark = async (remark: string, parentRemarkId?: string | null) => {
    if (!order) return;
    const response = await addOrderRemark(order.id, remark, parentRemarkId);
    if (response.success) {
      const newRemark = response.data;
      setOrder((prev) => {
        if (!prev) return prev;
        return { ...prev, remarks: [...prev.remarks, newRemark] };
      });
      setHighlightedRemarkId(newRemark.id);
      if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
      highlightTimeoutRef.current = setTimeout(() => setHighlightedRemarkId(null), 2500);
      setReplyingTo(null);
    }
  };

  const handleReply = (remark: OrderRemark) => {
    setReplyingTo(remark);
  };

  const handlePrint = () => {
    if (!order) return;
    const { remarks, statusHistory, canChangeStatus, ...orderFields } = order;
    void printLabels([orderFields]);
  };

  const handleOverrideStatus = async () => {
    if (!order || !overrideStatus || overrideStatus === order.status) return;
    try {
      setOverrideSaving(true);
      setOverrideError('');
      await updateOrderStatus(order.id, overrideStatus, overrideRemarks.trim() || undefined);
      setOverrideStatus('');
      setOverrideRemarks('');
      await fetchOrder();
    } catch (err: any) {
      setOverrideError(err?.response?.data?.message ?? 'Failed to update status');
    } finally {
      setOverrideSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="od-page">
        <div className="od-container">
          <div className="od-loading">
            <div className="od-skeleton od-skeleton-header" />
            <div className="od-skeleton od-skeleton-card" />
            <div className="od-skeleton od-skeleton-timeline" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="od-page">
        <div className="od-container">
          <button className="od-back" onClick={() => navigate(-1)}>
            <ArrowLeft size={16} />
            Back
          </button>
          <div className="od-empty">
            <div className="od-empty-icon">
              <Package size={24} strokeWidth={1.5} />
            </div>
            <h3>{error || 'Order not found'}</h3>
            <p>The order you are looking for does not exist or has been removed.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="od-page">
      <div className="od-container">
        <button className="od-back" onClick={() => navigate(-1)}>
          <ArrowLeft size={16} />
          Back to orders
        </button>

        <OrderDetailHeader
          trackingId={order.trackingId}
          orderNumber={order.orderNumber}
          status={order.status}
          orderType={order.orderType}
          serviceType={order.serviceType}
          createdAt={order.createdAtRaw}
          orderId={order.id}
          onPrint={handlePrint}
        />

        {isSuperAdmin && (
          <div className="od-override">
            <div className="od-override-title">
              <ShieldAlert size={15} />
              <span>Super admin: force status</span>
            </div>
            <div className="od-override-controls">
              <select
                className="od-override-select"
                value={overrideStatus}
                onChange={(e) => setOverrideStatus(e.target.value as ParcelStatus | '')}
                disabled={overrideSaving}
                aria-label="New status"
              >
                <option value="">Select new status...</option>
                {(Object.keys(STATUS_LABEL) as ParcelStatus[])
                  .filter((s) => s !== order.status && !OVERRIDE_EXCLUDED.includes(s))
                  .map((s) => (
                    <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                  ))}
              </select>
              <input
                className="od-override-remarks"
                type="text"
                placeholder="Remarks (optional)"
                value={overrideRemarks}
                onChange={(e) => setOverrideRemarks(e.target.value)}
                disabled={overrideSaving}
              />
              <button
                className="od-override-apply"
                onClick={handleOverrideStatus}
                disabled={overrideSaving || !overrideStatus}
              >
                {overrideSaving ? 'Applying...' : 'Apply'}
              </button>
            </div>
            {overrideError && <p className="od-override-error">{overrideError}</p>}
          </div>
        )}

        <OrderInfoCards
          senderName={order.senderName}
          senderPhone={order.senderPhone}
          senderAddress={order.senderAddress}
          receiverName={order.receiverName}
          receiverPhone={order.receiverPhone}
          receiverAddress={order.receiverAddress}
          origin={order.origin}
          destination={order.destination}
          codAmount={order.codAmount}
          deliveryCharge={order.deliveryCharge}
          pieces={order.pieces}
          weightKg={order.weightKg}
        />

        <div className="od-activity">
          <div className="od-activity-left">
            <div className="od-section-header">
              <h2>Status Timeline</h2>
              <span className="od-section-count">{order.statusHistory.length}</span>
            </div>
            <OrderTimeline
              statusHistory={order.statusHistory}
              currentStatus={order.status}
            />
          </div>
          <div className="od-activity-right">
            <div className="od-remarks-header">
              <h2>Remarks</h2>
              <span className="od-section-count">{order.remarks.length}</span>
            </div>
            <OrderRemarks
              remarks={order.remarks}
              onReply={handleReply}
              highlightedRemarkId={highlightedRemarkId}
            />
            <OrderRemarkInput
              onSubmit={handleAddRemark}
              replyingTo={replyingTo}
              onCancelReply={() => setReplyingTo(null)}
            />
          </div>
        </div>

        <div className="od-pricelog">
          <div className="od-section-header">
            <h2>Price Log</h2>
            <span className="od-section-count">{order.priceLog.length}</span>
          </div>
          <OrderPriceLog entries={order.priceLog} />
        </div>
      </div>
    </div>
  );
};

export default OrderDetailPage;
