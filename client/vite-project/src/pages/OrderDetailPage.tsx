import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import {
  ArrowLeft,
  Box,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  Map,
  MapPin,
  MessageCircle,
  Package,
  Phone,
  Printer,
  RefreshCw,
  Send,
  Tag,
  Truck,
  User,
  Weight,
  X,
  XCircle,
} from 'lucide-react';
import Button from '../components/Button';
import StatusChip, { type StatusChipTone } from '../components/StatusChip';
import {
  getOrderByTrackingId,
  addOrderRemark,
  type OrderDetail,
  type ParcelStatus,
  type OrderRemark,
} from '../services/orders.service';
import './OrderDetailPage.css';

const STATUS_LABELS: Record<ParcelStatus, string> = {
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

const STATUS_ICONS: Record<ParcelStatus, React.ReactNode> = {
  pickup_ordered: <Package size={14} />,
  rider_assigned: <Truck size={14} />,
  picked_up: <Box size={14} />,
  arrived: <MapPin size={14} />,
  ready_to_deliver: <CheckCircle2 size={14} />,
  sent_for_delivery: <Truck size={14} />,
  oov: <Truck size={14} />,
  dispatched: <Truck size={14} />,
  arrived_at_branch: <MapPin size={14} />,
  hold: <Clock size={14} />,
  loss_and_damage: <XCircle size={14} />,
  delivered: <CheckCircle2 size={14} />,
  failed_pickup: <XCircle size={14} />,
  failed_delivery: <XCircle size={14} />,
  cancelled: <XCircle size={14} />,
};

const getStatusTone = (status: ParcelStatus): StatusChipTone => {
  if (status === 'delivered') return 'success';
  if (['arrived', 'arrived_at_branch', 'rider_assigned'].includes(status)) return 'info';
  if (['failed_pickup', 'failed_delivery', 'loss_and_damage'].includes(status)) return 'danger';
  if (status === 'cancelled') return 'neutral';
  return 'warning';
};

const getTimelineColor = (status: ParcelStatus): string => {
  if (status === 'delivered') return 'timeline-success';
  if (['failed_pickup', 'failed_delivery', 'loss_and_damage', 'cancelled'].includes(status)) return 'timeline-danger';
  if (status === 'hold') return 'timeline-warning';
  return 'timeline-active';
};

const getInitials = (name: string) =>
  name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);

const getAvatarColor = (name: string): string => {
  const lower = name.toLowerCase();
  if (lower.includes('admin') || lower.includes('super')) return '#c2410c';
  if (lower.includes('vendor') || lower.includes('branch')) return '#0f766e';
  if (lower.includes('rider')) return '#16a34a';
  const colors = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#3b82f6', '#14b8a6'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
};

const formatDate = (dateStr: string) => {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

const formatRelativeTime = (dateStr: string) => {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return formatDate(dateStr);
};

const formatMoney = (value: number) =>
  value.toLocaleString(undefined, { maximumFractionDigits: 0 });

const OrderDetailPage: React.FC = () => {
  const { trackingId } = useParams<{ trackingId: string }>();
  const navigate = useNavigate();
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);
  const bottomInputRef = useRef<HTMLTextAreaElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [justAddedId, setJustAddedId] = useState<string | null>(null);

  // Bottom reply input
  const [bottomText, setBottomText] = useState('');
  const [bottomSubmitting, setBottomSubmitting] = useState(false);
  const [bottomError, setBottomError] = useState('');

  // Inline reply
  const [replyingTo, setReplyingTo] = useState<OrderRemark | null>(null);
  const [inlineText, setInlineText] = useState('');
  const [inlineSubmitting, setInlineSubmitting] = useState(false);
  const [inlineError, setInlineError] = useState('');

  const loadOrder = useCallback(
    async (silent = false) => {
      if (!trackingId) return;
      if (!silent) setLoading(true);
      setError('');
      try {
        const res = await getOrderByTrackingId(trackingId);
        if (res?.success && res.data) setOrder(res.data);
      } catch (err: any) {
        setError(err.response?.data?.message || 'Failed to load order details');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [trackingId],
  );

  useEffect(() => { loadOrder(); }, [loadOrder]);
  useEffect(() => { window.scrollTo(0, 0); }, [trackingId]);

  useEffect(() => {
    if (order && qrCanvasRef.current) {
      QRCode.toCanvas(qrCanvasRef.current, order.trackingId, {
        width: 120, margin: 1,
        color: { dark: '#1e293b', light: '#ffffff' },
      });
    }
  }, [order]);

  // Auto-scroll to newly added remark
  useEffect(() => {
    if (!justAddedId) return;
    const timer = setTimeout(() => {
      const el = document.querySelector(`[data-remark-id="${justAddedId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [justAddedId]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [order?.remarks.length]);

  const copyTrackingId = async () => {
    if (!order) return;
    try {
      await navigator.clipboard.writeText(order.trackingId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* */ }
  };

  const handlePrint = () => window.print();

  const submitBottomReply = async () => {
    if (!order) return;
    const trimmed = bottomText.trim();
    if (!trimmed) return;
    setBottomSubmitting(true);
    setBottomError('');
    try {
      const prevIds = new Set(order.remarks.map((r) => r.id));
      const parentId = replyingTo?.id || undefined;
      await addOrderRemark(order.id, trimmed, parentId);
      setBottomText('');
      setReplyingTo(null);
      setInlineText('');
      await loadOrder(true);
      // Find the new remark
      if (!trackingId) return;
      const updated = await getOrderByTrackingId(trackingId);
      if (updated?.success && updated.data) {
        const newRemark = updated.data.remarks.find((r) => !prevIds.has(r.id));
        if (newRemark) {
          setJustAddedId(newRemark.id);
          setTimeout(() => setJustAddedId(null), 2500);
        }
      }
    } catch (err: any) {
      setBottomError(err.response?.data?.message || 'Failed to post.');
    } finally {
      setBottomSubmitting(false);
    }
  };

  const openInlineReply = (remark: { id: string; addedBy: string }) => {
    setReplyingTo(remark as OrderRemark);
    setInlineText('');
    setInlineError('');
    bottomInputRef.current?.focus();
  };

  const cancelReply = () => {
    setReplyingTo(null);
    setInlineText('');
  };

  const submitInlineReply = async () => {
    if (!order || !replyingTo) return;
    const trimmed = inlineText.trim();
    if (!trimmed) return;
    setInlineSubmitting(true);
    setInlineError('');
    try {
      const prevIds = new Set(order.remarks.map((r) => r.id));
      await addOrderRemark(order.id, trimmed, replyingTo.id);
      setInlineText('');
      setReplyingTo(null);
      await loadOrder(true);
      // Find the new remark
      if (!trackingId) return;
      const updated = await getOrderByTrackingId(trackingId);
      if (updated?.success && updated.data) {
        const newRemark = updated.data.remarks.find((r) => !prevIds.has(r.id));
        if (newRemark) {
          setJustAddedId(newRemark.id);
          setTimeout(() => setJustAddedId(null), 2500);
        }
      }
    } catch (err: any) {
      setInlineError(err.response?.data?.message || 'Failed to post.');
    } finally {
      setInlineSubmitting(false);
    }
  };

  const currentStatusIndex = order
    ? order.statusHistory.findIndex((h) => h.newStatus === order.status)
    : -1;

  // Build tree structure for nested replies
  const buildTree = (remarks: OrderRemark[]) => {
    const nodeMap: Record<string, any> = {};
    const roots: any[] = [];

    remarks.forEach((r) => {
      nodeMap[r.id] = { ...r, children: [] };
    });

    remarks.forEach((r) => {
      const node = nodeMap[r.id];
      if (r.parentRemarkId && nodeMap[r.parentRemarkId]) {
        nodeMap[r.parentRemarkId].children.push(node);
      } else {
        roots.push(node);
      }
    });

    const sortByTime = (a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    roots.sort(sortByTime);
    const sortChildren = (nodes: any[]) => {
      nodes.forEach((n) => { n.children.sort(sortByTime); sortChildren(n.children); });
    };
    sortChildren(roots);

    return roots;
  };

  const remarkTree = order ? buildTree(order.remarks) : [];

  // Recursive remark component
  const RemarkNode: React.FC<{
    node: OrderRemark & { children: any[] };
    depth?: number;
    highlightId?: string | null;
  }> = ({ node, depth = 0, highlightId }) => {
    const hasChildren = node.children.length > 0;
    const isMaxDepth = depth >= 3;
    const isHighlighted = highlightId === node.id;

    return (
      <div
        className={`od-chat-group ${depth > 0 ? 'od-chat-group-nested' : ''} ${isHighlighted ? 'od-chat-msg-highlight' : ''}`}
        data-remark-id={node.id}
      >
        <div className={`od-chat-msg ${depth > 0 ? 'od-chat-msg-reply' : ''}`}>
          <div
            className={`od-chat-avatar ${depth > 0 ? 'od-chat-avatar-sm' : ''}`}
            style={{ background: getAvatarColor(node.addedBy) }}
          >
            {getInitials(node.addedBy)}
          </div>
          <div className="od-chat-body">
            <div className="od-chat-sender-row">
              <span className="od-chat-name">{node.addedBy}</span>
              <span className="od-chat-time">{formatRelativeTime(node.createdAt)}</span>
            </div>
            <div className={`od-chat-bubble ${depth > 0 ? 'od-chat-bubble-reply' : ''}`}>
              <p>{node.remark}</p>
            </div>
            {!isMaxDepth && (
              <button className="od-chat-reply-btn" onClick={() => openInlineReply(node)}>
                Reply
              </button>
            )}
          </div>
        </div>

        {/* Nested children */}
        {hasChildren && (
          <div className="od-chat-replies">
            {node.children.map((child) => (
              <RemarkNode key={child.id} node={child} depth={depth + 1} highlightId={highlightId} />
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="od-page">
      <div className="od-container">
        <button className="od-back" onClick={() => navigate(-1)}>
          <ArrowLeft size={16} /> Back to Orders
        </button>

        {loading && (
          <div className="od-loading">
            <div className="od-skeleton od-skeleton-header" />
            <div className="od-skeleton od-skeleton-card" />
            <div className="od-skeleton od-skeleton-timeline" />
          </div>
        )}

        {!loading && error && (
          <div className="od-empty">
            <Package size={48} strokeWidth={1.5} />
            <h3>Order not found</h3>
            <p>{error}</p>
            <Button variant="primary" onClick={() => loadOrder()}>
              <RefreshCw size={16} /> Try again
            </Button>
          </div>
        )}

        {!loading && order && (
          <>
            {/* ===== HEADER ===== */}
            <div className="od-header">
              <div className="od-header-left">
                <div className="od-tracking-row">
                  <h1 className="od-tracking-id">{order.trackingId}</h1>
                  <button className="od-copy-btn" onClick={copyTrackingId} aria-label="Copy tracking ID">
                    <Copy size={14} />
                    {copied && <span className="od-copy-tooltip">Copied!</span>}
                  </button>
                </div>
                <div className="od-header-meta">
                  <StatusChip tone={getStatusTone(order.status)}>
                    {STATUS_LABELS[order.status]}
                  </StatusChip>
                  <span className="od-meta-divider" />
                  <span className="od-meta-item"><Tag size={14} />{order.orderType.charAt(0).toUpperCase() + order.orderType.slice(1)}</span>
                  {order.riderName && (
                    <>
                      <span className="od-meta-divider" />
                      <span className="od-meta-item"><Truck size={14} />{order.riderName}</span>
                    </>
                  )}
                </div>
              </div>
              <div className="od-header-actions">
                <button className="od-header-icon-btn" onClick={() => setShowQr(!showQr)} title="Show QR Code" aria-label="Show QR Code">
                  <canvas ref={qrCanvasRef} className="od-header-qr-canvas" />
                </button>
                <button className="od-header-icon-btn" onClick={handlePrint} title="Print" aria-label="Print order">
                  <Printer size={18} />
                </button>
              </div>
            </div>

            {/* ===== INFO CARDS ===== */}
            <div className="od-info-grid">
              {/* Sender */}
              <div className="od-info-card">
                <div className="od-info-card-icon od-info-icon-sender">
                  <User size={18} />
                </div>
                <div className="od-info-card-body">
                  <span className="od-info-card-label">Sender</span>
                  <p className="od-info-card-name">{order.senderName}</p>
                  <p className="od-info-card-detail"><Phone size={13} /> {order.senderPhone}</p>
                </div>
              </div>

              {/* Receiver */}
              <div className="od-info-card">
                <div className="od-info-card-icon od-info-icon-receiver">
                  <User size={18} />
                </div>
                <div className="od-info-card-body">
                  <span className="od-info-card-label">Receiver</span>
                  <p className="od-info-card-name">{order.receiverName}</p>
                  <p className="od-info-card-detail"><Phone size={13} /> {order.receiverPhone}</p>
                </div>
              </div>

              {/* Route */}
              <div className="od-info-card od-info-card-full">
                <div className="od-info-card-icon od-info-icon-route">
                  <Map size={18} />
                </div>
                <div className="od-info-card-body">
                  <span className="od-info-card-label">Route</span>
                  <div className="od-route-visual">
                    <div className="od-route-end">
                      <span className="od-route-dot-sm od-route-dot-origin" />
                      <div>
                        <span className="od-route-sub">Origin</span>
                        <span className="od-route-city">{order.origin}</span>
                      </div>
                    </div>
                    <div className="od-route-arrow">
                      <div className="od-route-arrow-line" />
                      <Truck size={14} className="od-route-arrow-icon" />
                      <div className="od-route-arrow-line" />
                    </div>
                    <div className="od-route-end">
                      <span className="od-route-dot-sm od-route-dot-dest" />
                      <div>
                        <span className="od-route-sub">Destination</span>
                        <span className="od-route-city">{order.destination}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Package & Finance */}
              <div className="od-info-card od-info-card-full">
                <div className="od-info-card-icon od-info-icon-finance">
                  <CreditCard size={18} />
                </div>
                <div className="od-info-card-body">
                  <span className="od-info-card-label">Package & Finance</span>
                  <div className="od-finance-grid">
                    <div className="od-finance-item">
                      <Package size={14} />
                      <span className="od-finance-label">Pieces</span>
                      <span className="od-finance-value">{order.pieces}</span>
                    </div>
                    {order.weightKg && (
                      <div className="od-finance-item">
                        <Weight size={14} />
                        <span className="od-finance-label">Weight</span>
                        <span className="od-finance-value">{order.weightKg} kg</span>
                      </div>
                    )}
                    <div className="od-finance-item">
                      <CreditCard size={14} />
                      <span className="od-finance-label">COD</span>
                      <span className="od-finance-value">NPR {formatMoney(order.codAmount)}</span>
                    </div>
                    <div className="od-finance-item">
                      <CreditCard size={14} />
                      <span className="od-finance-label">D. Charge</span>
                      <span className="od-finance-value">NPR {formatMoney(order.deliveryCharge)}</span>
                    </div>
                    {order.riderName && (
                      <div className="od-finance-item">
                        <Truck size={14} />
                        <span className="od-finance-label">Rider</span>
                        <span className="od-finance-value">{order.riderName}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* ===== TIMELINE ===== */}
            {order.statusHistory.length > 0 && (
              <div className="od-section">
                <div className="od-section-header">
                  <Clock size={18} strokeWidth={1.5} />
                  <h2>Status History</h2>
                  <span className="od-section-count">{order.statusHistory.length}</span>
                </div>
                <div className="od-timeline">
                  {order.statusHistory.map((entry, index) => {
                    const isLatest = index === currentStatusIndex;
                    const isTerminal = ['delivered', 'cancelled', 'failed_pickup', 'failed_delivery'].includes(entry.newStatus);
                    return (
                      <div key={entry.id} className={`od-timeline-item ${getTimelineColor(entry.newStatus)} ${isLatest ? 'od-timeline-current' : ''}`}>
                        <div className="od-timeline-connector">
                          <div className={`od-timeline-dot ${isTerminal ? 'od-timeline-dot-terminal' : ''}`}>
                            {STATUS_ICONS[entry.newStatus]}
                          </div>
                          {index < order.statusHistory.length - 1 && <div className="od-timeline-line" />}
                        </div>
                        <div className="od-timeline-content">
                          <div className="od-timeline-header">
                            <StatusChip tone={getStatusTone(entry.newStatus)}>
                              {STATUS_LABELS[entry.newStatus]}
                            </StatusChip>
                          </div>
                          {entry.remarks && <p className="od-timeline-remarks">{entry.remarks}</p>}
                          <div className="od-timeline-meta">
                            <span className="od-timeline-by"><User size={13} />{entry.changedBy}</span>
                            <span className="od-timeline-dot-sep" />
                            <span className="od-timeline-time"><Clock size={13} />{formatDate(entry.createdAt)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ===== REMARKS ===== */}
            <div className="od-section od-remarks-section">
              <div className="od-section-header">
                <MessageCircle size={18} strokeWidth={1.5} />
                <h2>Remarks</h2>
                <span className="od-section-count">{order.remarks.length}</span>
              </div>

              {/* Messages Thread */}
              <div className="od-chat-thread">
                {remarkTree.length === 0 && (
                  <div className="od-chat-empty">
                    <MessageCircle size={40} strokeWidth={1} />
                    <p>No remarks yet</p>
                    <span>Start the conversation about this order.</span>
                  </div>
                )}

                {remarkTree.map((node) => (
                  <RemarkNode key={node.id} node={node} highlightId={justAddedId} />
                ))}
                <div ref={threadEndRef} />
              </div>

              {/* Inline reply indicator */}
              {replyingTo && (
                <div className="od-bottom-replying-to">
                  <div className="od-bottom-replying-preview">
                    <span className="od-bottom-replying-label">Replying to</span>
                    <strong>{replyingTo.addedBy}</strong>
                    <span className="od-bottom-replying-snippet">
                      {replyingTo.remark.length > 40 ? replyingTo.remark.slice(0, 40) + '...' : replyingTo.remark}
                    </span>
                  </div>
                  <button className="od-bottom-replying-close" onClick={cancelReply} aria-label="Cancel reply">
                    <X size={14} />
                  </button>
                </div>
              )}

              {/* Bottom Input - Instagram Style */}
              <div className="od-bottom-input-bar">
                <div className="od-bottom-input-wrap">
                  <textarea
                    ref={bottomInputRef}
                    className="od-bottom-input"
                    placeholder={replyingTo ? `Reply to ${replyingTo.addedBy}...` : 'Write a remark...'}
                    value={replyingTo ? inlineText : bottomText}
                    onChange={(e) => replyingTo ? setInlineText(e.target.value) : setBottomText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        replyingTo ? submitInlineReply() : submitBottomReply();
                      }
                    }}
                    rows={1}
                    disabled={bottomSubmitting || inlineSubmitting}
                  />
                  <button
                    className="od-bottom-send"
                    onClick={replyingTo ? submitInlineReply : submitBottomReply}
                    disabled={bottomSubmitting || inlineSubmitting || (replyingTo ? !inlineText.trim() : !bottomText.trim())}
                    aria-label="Send"
                  >
                    <Send size={18} />
                  </button>
                </div>
                {(bottomError || inlineError) && (
                  <p className="od-bottom-error">{bottomError || inlineError}</p>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default OrderDetailPage;
