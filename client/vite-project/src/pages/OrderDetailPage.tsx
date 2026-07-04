import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Package } from 'lucide-react';
import {
  getOrderByTrackingId,
  addOrderRemark,
  subscribeToOrderStatusChanged,
  type OrderDetail,
  type OrderRemark,
} from '../services/orders.service';
import OrderDetailHeader from '../components/order-detail/OrderDetailHeader';
import OrderInfoCards from '../components/order-detail/OrderInfoCards';
import OrderTimeline from '../components/order-detail/OrderTimeline';
import OrderRemarks from '../components/order-detail/OrderRemarks';
import OrderRemarkInput from '../components/order-detail/OrderRemarkInput';
import './OrderDetailPage.css';

const OrderDetailPage: React.FC = () => {
  const { trackingId } = useParams<{ trackingId: string }>();
  const navigate = useNavigate();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<OrderRemark | null>(null);
  const [highlightedRemarkId, setHighlightedRemarkId] = useState<string | null>(null);

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
      setTimeout(() => setHighlightedRemarkId(null), 2500);
      setReplyingTo(null);
    }
  };

  const handleReply = (remark: OrderRemark) => {
    setReplyingTo(remark);
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
          createdAt={order.createdAt}
          orderId={order.id}
        />

        <OrderInfoCards
          senderName={order.senderName}
          senderPhone={order.senderPhone}
          receiverName={order.receiverName}
          receiverPhone={order.receiverPhone}
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
      </div>
    </div>
  );
};

export default OrderDetailPage;
