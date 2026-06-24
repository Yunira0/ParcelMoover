import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import QRCode from 'qrcode';
import {
  ArrowLeft,
  Package,
  MapPin,
  Phone,
  User,
  Calendar,
  Truck,
  Weight,
  Hash,
  MessageSquare,
  Copy,
  Check,
  AlertCircle,
  Send,
  CornerDownRight,
  CreditCard,
} from 'lucide-react';
import Button from '../components/Button';
import StatusChip, { type StatusChipTone } from '../components/StatusChip';
import {
  getOrderDetail,
  createOrderRemark,
  replyToOrderRemark,
  type OrderDetailData,
  type OrderDetailRemark,
} from '../services/orders.service';
import './OrderDetail.css';

const STATUS_LABELS: Record<string, string> = {
  pickup_ordered: 'Pickup Ordered',
  rider_assigned: 'Rider Assigned',
  picked_up: 'Picked Up',
  arrived: 'Arrived',
  ready_to_deliver: 'Ready to Deliver',
  sent_for_delivery: 'In Transit',
  oov: 'Out of Vehicle',
  dispatched: 'Dispatched',
  arrived_at_branch: 'Arrived at Branch',
  hold: 'On Hold',
  loss_and_damage: 'Loss & Damage',
  delivered: 'Delivered',
  failed_pickup: 'Failed Pickup',
  failed_delivery: 'Failed Delivery',
  cancelled: 'Cancelled',
};

const STATUS_TONE: Record<string, StatusChipTone> = {
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
  failed_pickup: 'danger',
  failed_delivery: 'danger',
  cancelled: 'danger',
};

const SERVICE_TYPE_LABELS: Record<string, string> = {
  dtd: 'Door to Door',
  btd: 'Branch to Door',
  btb: 'Branch to Branch',
  dtb: 'Door to Branch',
};

const ORDER_TYPE_LABELS: Record<string, string> = {
  delivery: 'Delivery',
  exchange: 'Exchange',
  return: 'Return',
};

const formatTimestamp = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

const formatMoney = (amount: number) =>
  new Intl.NumberFormat('en-NP', { style: 'currency', currency: 'NPR', minimumFractionDigits: 0 }).format(amount);

// Role-gated display name for status history
const getChangedByName = (
  entry: { actorName: string | null; branchName: string | null },
  isPrivileged: boolean,
) => {
  if (isPrivileged) return entry.actorName || 'System';
  return entry.branchName || 'System';
};

const getInitials = (name: string) =>
  name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);

const OrderDetail: React.FC = () => {
  const { trackingId } = useParams<{ trackingId: string }>();
  const navigate = useNavigate();

  const [data, setData] = useState<OrderDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [copied, setCopied] = useState(false);

  // Remarks
  const [newRemark, setNewRemark] = useState('');
  const [submittingRemark, setSubmittingRemark] = useState(false);
  const [replyTargetId, setReplyTargetId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replySubmitting, setReplySubmitting] = useState(false);
  const replyTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Determine role from localStorage
  const isPrivileged = (() => {
    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      const roles: string[] = user.roles || [];
      return roles.includes('super_admin') || roles.includes('admin');
    } catch {
      return false;
    }
  })();

  useEffect(() => {
    if (!trackingId) return;
    setLoading(true);
    setError('');
    getOrderDetail(trackingId)
      .then((res) => {
        setData(res.data);
        // Generate QR code
        QRCode.toDataURL(trackingId, {
          width: 160,
          margin: 1,
          color: { dark: '#1e293b', light: '#ffffff' },
        }).then(setQrDataUrl);
      })
      .catch((err) => {
        setError(err.response?.data?.message || 'Failed to load order details');
      })
      .finally(() => setLoading(false));
  }, [trackingId]);

  useEffect(() => {
    if (replyTargetId && replyTextareaRef.current) {
      replyTextareaRef.current.focus();
    }
  }, [replyTargetId]);

  const handleCopyTrackingId = useCallback(() => {
    if (!trackingId) return;
    navigator.clipboard.writeText(trackingId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [trackingId]);

  const handleAddRemark = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRemark.trim() || !data || submittingRemark) return;
    setSubmittingRemark(true);
    try {
      await createOrderRemark(data.parcel.id, newRemark.trim());
      setNewRemark('');
      const res = await getOrderDetail(trackingId!);
      setData(res.data);
    } catch {
      // silently fail
    } finally {
      setSubmittingRemark(false);
    }
  };

  const handleReply = async (remarkId: string) => {
    if (!replyText.trim() || !data || replySubmitting) return;
    setReplySubmitting(true);
    try {
      await replyToOrderRemark(data.parcel.id, remarkId, replyText.trim());
      setReplyText('');
      setReplyTargetId(null);
      const res = await getOrderDetail(trackingId!);
      setData(res.data);
    } catch {
      // silently fail
    } finally {
      setReplySubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="order-detail-container">
        <div className="order-detail-loading">
          <div className="od-skeleton-header" />
          <div className="od-skeleton-grid" />
          <div className="od-skeleton-timeline" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="order-detail-container">
        <div className="order-detail-error">
          <AlertCircle size={48} className="od-error-icon" />
          <h2>Order Not Found</h2>
          <p>{error || 'The order you are looking for does not exist.'}</p>
          <Button variant="primary" onClick={() => navigate('/orders')}>
            <ArrowLeft size={16} />
            Back to Orders
          </Button>
        </div>
      </div>
    );
  }

  const { parcel, sender, receiver, statusHistory, remarks, codCollection } = data;

  return (
    <div className="order-detail-container">
      {/* Header */}
      <div className="od-header">
        <div className="od-header-left">
          <Link to="/orders" className="od-back-link">
            <ArrowLeft size={18} />
            <span>Orders</span>
          </Link>
          <div className="od-tracking-row">
            <h1 className="od-tracking-id">{parcel.trackingId}</h1>
            <button
              className="od-copy-btn"
              onClick={handleCopyTrackingId}
              title="Copy tracking ID"
              type="button"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
            <StatusChip tone={STATUS_TONE[parcel.status] || 'neutral'}>
              {STATUS_LABELS[parcel.status] || parcel.status}
            </StatusChip>
          </div>
        </div>
        <div className="od-header-right">
          <div className="od-qr-card">
            {qrDataUrl && <img src={qrDataUrl} alt={`QR code for ${parcel.trackingId}`} className="od-qr-image" />}
            <span className="od-qr-label">{parcel.trackingId}</span>
          </div>
        </div>
      </div>

      {/* Info cards grid */}
      <div className="od-info-grid">
        {/* Sender */}
        <div className="od-card">
          <div className="od-card-header">
            <User size={16} className="od-card-icon" />
            <h3>Sender</h3>
          </div>
          <div className="od-card-body">
            <p className="od-info-name">{sender.name}</p>
            <p className="od-info-detail"><Phone size={13} /> {sender.phone}</p>
            {sender.address && <p className="od-info-detail"><MapPin size={13} /> {sender.address}</p>}
          </div>
        </div>

        {/* Receiver */}
        <div className="od-card">
          <div className="od-card-header">
            <User size={16} className="od-card-icon" />
            <h3>Receiver</h3>
          </div>
          <div className="od-card-body">
            <p className="od-info-name">{receiver.name}</p>
            <p className="od-info-detail"><Phone size={13} /> {receiver.phone}</p>
            {receiver.address && <p className="od-info-detail"><MapPin size={13} /> {receiver.address}</p>}
          </div>
        </div>

        {/* Shipment */}
        <div className="od-card">
          <div className="od-card-header">
            <Package size={16} className="od-card-icon" />
            <h3>Shipment Details</h3>
          </div>
          <div className="od-card-body od-info-grid-inner">
            <div className="od-info-field">
              <span className="od-info-label">Order Type</span>
              <span className="od-info-value">{ORDER_TYPE_LABELS[parcel.orderType] || parcel.orderType}</span>
            </div>
            <div className="od-info-field">
              <span className="od-info-label">Service</span>
              <span className="od-info-value">{SERVICE_TYPE_LABELS[parcel.serviceType] || parcel.serviceType}</span>
            </div>
            <div className="od-info-field">
              <span className="od-info-label">Pieces</span>
              <span className="od-info-value"><Hash size={13} /> {parcel.pieces}</span>
            </div>
            {parcel.weightKg != null && (
              <div className="od-info-field">
                <span className="od-info-label">Weight</span>
                <span className="od-info-value"><Weight size={13} /> {parcel.weightKg} kg</span>
              </div>
            )}
            <div className="od-info-field">
              <span className="od-info-label">Origin</span>
              <span className="od-info-value"><MapPin size={13} /> {data.origin}</span>
            </div>
            <div className="od-info-field">
              <span className="od-info-label">Destination</span>
              <span className="od-info-value"><MapPin size={13} /> {data.destination}</span>
            </div>
            {data.currentLocation && (
              <div className="od-info-field">
                <span className="od-info-label">Current Location</span>
                <span className="od-info-value"><MapPin size={13} /> {data.currentLocation}</span>
              </div>
            )}
            {data.vendorName && (
              <div className="od-info-field">
                <span className="od-info-label">Vendor</span>
                <span className="od-info-value">{data.vendorName}</span>
              </div>
            )}
          </div>
        </div>

        {/* Financials */}
        <div className="od-card">
          <div className="od-card-header">
            <CreditCard size={16} className="od-card-icon" />
            <h3>Financials</h3>
          </div>
          <div className="od-card-body od-info-grid-inner">
            <div className="od-info-field">
              <span className="od-info-label">Delivery Charge</span>
              <span className="od-info-value">{formatMoney(parcel.deliveryCharge)}</span>
            </div>
            <div className="od-info-field">
              <span className="od-info-label">COD Amount</span>
              <span className="od-info-value">{formatMoney(parcel.codAmount)}</span>
            </div>
            {codCollection && (
              <>
                <div className="od-info-field">
                  <span className="od-info-label">Collected</span>
                  <span className="od-info-value">{formatMoney(codCollection.collectedAmount)}</span>
                </div>
                <div className="od-info-field">
                  <span className="od-info-label">Remitted</span>
                  <span className="od-info-value">{formatMoney(codCollection.remittedAmount)}</span>
                </div>
                <div className="od-info-field">
                  <span className="od-info-label">COD Status</span>
                  <span className="od-info-value">{codCollection.paymentStatus}</span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Timeline & Remarks row */}
        <div className="od-timeline-remarks-col">
          {/* Status History Timeline */}
          <div className="od-card od-timeline-card">
            <div className="od-card-header">
              <Truck size={16} className="od-card-icon" />
              <h3>Status History</h3>
            </div>
            <div className="od-card-body">
              {statusHistory.length === 0 ? (
                <p className="od-empty-text">No status history available.</p>
              ) : (
                <div className="od-timeline">
                  {statusHistory.map((entry, idx) => (
                    <div key={entry.id} className={`od-timeline-item ${idx === statusHistory.length - 1 ? 'od-timeline-current' : ''}`}>
                      <div className="od-timeline-dot-wrapper">
                        <div className="od-timeline-dot" />
                        {idx < statusHistory.length - 1 && <div className="od-timeline-line" />}
                      </div>
                      <div className="od-timeline-content">
                        <div className="od-timeline-top">
                          <span className="od-timeline-status">{STATUS_LABELS[entry.newStatus] || entry.newStatus}</span>
                          <span className="od-timeline-time">
                            <Calendar size={12} />
                            {formatTimestamp(entry.timestamp)}
                          </span>
                        </div>
                        <div className="od-timeline-meta">
                          <span className="od-timeline-actor">
                            By: {getChangedByName(entry, isPrivileged)}
                          </span>
                          {entry.locationName && (
                            <span className="od-timeline-location">
                              <MapPin size={12} /> {entry.locationName}
                            </span>
                          )}
                        </div>
                        {entry.remarks && (
                          <p className="od-timeline-remarks">{entry.remarks}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Remarks */}
          <div className="od-card od-remarks-card">
            <div className="od-card-header">
              <MessageSquare size={16} className="od-card-icon" />
              <h3>Remarks</h3>
            </div>
            <div className="od-card-body">
              <form className="od-remark-form" onSubmit={handleAddRemark}>
                <input
                  type="text"
                  className="od-remark-input"
                  value={newRemark}
                  onChange={(e) => setNewRemark(e.target.value)}
                  placeholder="Add a remark..."
                  maxLength={2000}
                />
                <Button type="submit" variant="primary" size="sm" disabled={submittingRemark || !newRemark.trim()}>
                  <Send size={14} />
                </Button>
              </form>

              {remarks.length === 0 ? (
                <p className="od-empty-text">No remarks yet.</p>
              ) : (
                <div className="od-remarks-list">
                  {remarks.map((thread) => (
                    <RemarkThread
                      key={thread.id}
                      thread={thread}
                      replyTargetId={replyTargetId}
                      replyText={replyText}
                      replyTextareaRef={replyTargetId === thread.id ? replyTextareaRef : undefined}
                      onReplyTextChange={setReplyText}
                      onToggleReply={(id) => {
                        setReplyTargetId(replyTargetId === id ? null : id);
                        setReplyText('');
                      }}
                      onSubmitReply={() => handleReply(thread.id)}
                      replySubmitting={replySubmitting}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Sub-component for a remark thread
const RemarkThread: React.FC<{
  thread: OrderDetailRemark;
  replyTargetId: string | null;
  replyText: string;
  replyTextareaRef: React.RefObject<HTMLTextAreaElement | null> | undefined;
  onReplyTextChange: (text: string) => void;
  onToggleReply: (id: string) => void;
  onSubmitReply: () => void;
  replySubmitting: boolean;
}> = ({ thread, replyTargetId, replyText, replyTextareaRef, onReplyTextChange, onToggleReply, onSubmitReply, replySubmitting }) => (
  <div className="od-remark-thread">
    <div className="od-remark-item">
      <div className="od-remark-avatar">{getInitials(thread.authorName)}</div>
      <div className="od-remark-content">
        <div className="od-remark-header">
          <span className="od-remark-author">{thread.authorName}</span>
          <span className="od-remark-time">{formatTimestamp(thread.createdAt)}</span>
        </div>
        <p className="od-remark-text">{thread.remark}</p>
      </div>
    </div>
    <button
      type="button"
      className="od-remark-reply-toggle"
      onClick={() => onToggleReply(thread.id)}
    >
      <CornerDownRight size={13} />
      {replyTargetId === thread.id ? 'Cancel' : 'Reply'}
    </button>

    {thread.replies.length > 0 && (
      <div className="od-remark-replies">
        {thread.replies.map((reply) => (
          <div key={reply.id} className="od-remark-item od-remark-reply-item">
            <div className="od-remark-avatar">{getInitials(reply.authorName)}</div>
            <div className="od-remark-content">
              <div className="od-remark-header">
                <span className="od-remark-author">{reply.authorName}</span>
                <span className="od-remark-time">{formatTimestamp(reply.createdAt)}</span>
              </div>
              <p className="od-remark-text">{reply.remark}</p>
            </div>
          </div>
        ))}
      </div>
    )}

    {replyTargetId === thread.id && (
      <div className="od-reply-form">
        <input
          ref={replyTextareaRef as any}
          type="text"
          className="od-remark-input"
          value={replyText}
          onChange={(e) => onReplyTextChange(e.target.value)}
          placeholder="Write a reply..."
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmitReply(); } }}
        />
        <Button variant="primary" size="sm" disabled={replySubmitting || !replyText.trim()} onClick={onSubmitReply}>
          <Send size={14} />
        </Button>
      </div>
    )}
  </div>
);

export default OrderDetail;
