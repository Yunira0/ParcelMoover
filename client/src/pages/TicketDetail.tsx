import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Building2, CheckCircle2, Clock, FileText, Mail, MapPin, MessageSquare, Phone, RefreshCw, RotateCcw, Send, Tag } from 'lucide-react';
import Button from '../components/Button';
import { isAdminSide, isVendorSide } from '../utils/auth';
import StatusChip, { type StatusChipTone } from '../components/StatusChip';
import {
  getTicketById,
  replyToTicket,
  setTicketStatus,
  TICKET_CATEGORY_LABELS,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
  type TicketPriority,
  type TicketStatus,
  type TicketDetail as TicketDetailType,
} from '../services/tickets.service';
import { markNotificationsReadByTrackingId } from '../services/notifications.service';
import './RemarkDetail.css';
import { toBsDate } from '../utils/nepaliDate';
import './TicketDetail.css';

const STATUS_TONE: Record<TicketStatus, StatusChipTone> = {
  pending: 'warning',
  open: 'info',
  closed: 'success',
};

// Mirrors the priority tones used on the Tickets list, so a ticket reads the
// same in the table there and on this detail page.
const PRIORITY_TONE: Record<TicketPriority, StatusChipTone> = {
  urgent: 'danger',
  high: 'warning',
  medium: 'info',
  low: 'neutral',
};

const getInitials = (name: string) => name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);

const getAvatarColor = (name: string) => {
  const lower = name.toLowerCase();
  if (lower.includes('admin') || lower.includes('super')) return '#e24c00';
  if (lower.includes('vendor') || lower.includes('branch')) return '#0f766e';
  return '#64748b';
};

const formatRelativeTime = (dateStr: string) => {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;
  const diffMins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return toBsDate(date);
};

const TicketDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  // Admins triage/resolve/close; vendors only raise the ticket and converse.
  const isAdmin = isAdminSide();
  const [ticket, setTicket] = useState<TicketDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [replyText, setReplyText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [replyError, setReplyError] = useState('');
  const [statusUpdating, setStatusUpdating] = useState(false);
  const threadEndRef = useRef<HTMLDivElement>(null);

  const loadTicket = useCallback(async (silent = false) => {
    if (!id) return;
    if (!silent) setLoading(true);
    setError('');
    try {
      const res = await getTicketById(id);
      if (res?.success && res.data) {
        setTicket(res.data);
        // Support opening an un-opened ticket acknowledges it: pending → open.
        // Only staff/sales viewing counts; a vendor viewing their own ticket
        // shouldn't mark it as opened by support.
        if (res.data.status === 'pending' && !isVendorSide()) {
          try {
            await setTicketStatus(id, 'open');
            setTicket((prev) => (prev ? { ...prev, status: 'open' } : prev));
          } catch {
            // Non-fatal: the ticket still loaded; it just didn't auto-open.
          }
        }
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load ticket');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadTicket(); }, [loadTicket]);

  // Opening a ticket - however the user got here, not just via the bell -
  // clears any unread notification pointing at it (best-effort, doesn't
  // block or error the page if it fails).
  useEffect(() => {
    if (!id) return;
    markNotificationsReadByTrackingId(id).catch(() => {});
  }, [id]);
  useEffect(() => { threadEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [ticket]);

  const submitReply = async () => {
    if (!id) return;
    const trimmed = replyText.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setReplyError('');
    try {
      const res = await replyToTicket(id, trimmed);
      if (res?.success && res.data) setTicket(res.data);
      setReplyText('');
    } catch (err: any) {
      setReplyError(err.response?.data?.message || 'Failed to post reply.');
    } finally {
      setSubmitting(false);
    }
  };

  const changeStatus = async (status: TicketDetailType['status']) => {
    if (!id) return;
    setStatusUpdating(true);
    try {
      await setTicketStatus(id, status);
      await loadTicket(true);
    } finally {
      setStatusUpdating(false);
    }
  };

  return (
    <div className="page-container">
      <div className="page-content">
        <button className="back-link" onClick={() => navigate(-1)}>
          <ArrowLeft size={16} /> Back
        </button>

        {loading && (
          <div className="loading-state">
            <div className="skeleton skeleton-lg" />
            <div className="skeleton skeleton-md" />
          </div>
        )}

        {!loading && error && (
          <div className="empty-state">
            <MessageSquare size={48} strokeWidth={1.5} />
            <h3>Ticket not found</h3>
            <p>{error}</p>
            <Button variant="primary" onClick={() => loadTicket()}>
              <RefreshCw size={16} /> Try again
            </Button>
          </div>
        )}

        {!loading && ticket && (
          <>
            <div className="detail-header">
              <div className="detail-header-main">
                <div className="tracking-row">
                  <h1 className="tracking-id">{ticket.ticketId}</h1>
                  <StatusChip tone={STATUS_TONE[ticket.status]}>
                    {TICKET_STATUS_LABELS[ticket.status]}
                  </StatusChip>
                  <StatusChip tone={PRIORITY_TONE[ticket.priority]}>
                    {TICKET_PRIORITY_LABELS[ticket.priority]}
                  </StatusChip>
                </div>
                <p className="tracking-link">{ticket.subject}</p>
              </div>
              <div className="detail-header-actions">
                {isAdmin ? (
                  ticket.status !== 'closed' ? (
                    <Button variant="primary" onClick={() => changeStatus('closed')} disabled={statusUpdating}>
                      <CheckCircle2 size={16} /> Resolve & Close
                    </Button>
                  ) : (
                    <Button variant="secondary" onClick={() => changeStatus('open')} disabled={statusUpdating}>
                      <RotateCcw size={16} /> Reopen
                    </Button>
                  )
                ) : (
                  // Vendors can't change status - they see where their ticket stands.
                  <div className={`td-vendor-status td-vendor-status-${ticket.status}`}>
                    {ticket.status === 'closed' ? (
                      <><CheckCircle2 size={16} /> Resolved by support</>
                    ) : (
                      <><Clock size={16} /> Awaiting support</>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="detail-body">
              <aside className="detail-aside">
                {/* Vendor (client) that raised the ticket - shown first. */}
                {ticket.vendor && (
                  <div className="info-card td-vendor-card">
                    <div className="info-card-header">
                      <Building2 size={16} strokeWidth={1.5} />
                      <span>Vendor</span>
                    </div>
                    <p className="info-name">{ticket.vendor.name}</p>
                    {ticket.vendor.contactName && ticket.vendor.contactName !== ticket.vendor.name && (
                      <p className="info-detail">{ticket.vendor.contactName}</p>
                    )}
                    <div className="td-vendor-meta">
                      {ticket.vendor.phone && (
                        <span className="td-vendor-line"><Phone size={13} strokeWidth={1.5} />{ticket.vendor.phone}</span>
                      )}
                      {ticket.vendor.email && (
                        <span className="td-vendor-line"><Mail size={13} strokeWidth={1.5} />{ticket.vendor.email}</span>
                      )}
                      {(ticket.vendor.address || ticket.vendor.location) && (
                        <span className="td-vendor-line">
                          <MapPin size={13} strokeWidth={1.5} />
                          {[ticket.vendor.address, ticket.vendor.location].filter(Boolean).join(', ')}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* The original request text as a first-class element. */}
                <div className="info-card">
                  <div className="info-card-header">
                    <FileText size={16} strokeWidth={1.5} />
                    <span>Description</span>
                  </div>
                  <p className="td-description">
                    {ticket.description?.trim() || 'No description provided.'}
                  </p>
                </div>

                {/* Ticket attributes as a compact details table. */}
                <div className="info-card">
                  <div className="info-card-header">
                    <Tag size={16} strokeWidth={1.5} />
                    <span>Ticket details</span>
                  </div>
                  <table className="td-detail-table">
                    <tbody>
                      <tr>
                        <th>Category</th>
                        <td>{TICKET_CATEGORY_LABELS[ticket.category]}</td>
                      </tr>
                      {ticket.trackingId && (
                        <tr>
                          <th>Order</th>
                          <td>
                            <Link to={`/orders/track/${ticket.trackingId}`} className="tracking-id-link">
                              {ticket.trackingId}
                            </Link>
                          </td>
                        </tr>
                      )}
                      <tr>
                        <th>Priority</th>
                        <td>
                          <StatusChip tone={PRIORITY_TONE[ticket.priority]}>
                            {TICKET_PRIORITY_LABELS[ticket.priority]}
                          </StatusChip>
                        </td>
                      </tr>
                      <tr>
                        <th>Status</th>
                        <td>
                          <StatusChip tone={STATUS_TONE[ticket.status]}>
                            {TICKET_STATUS_LABELS[ticket.status]}
                          </StatusChip>
                        </td>
                      </tr>
                      <tr>
                        <th>Created</th>
                        <td>{toBsDate(ticket.createdAt)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </aside>

              <div className="detail-main">
                <div className="rd-chat-section">
                  <div className="rd-chat-header">
                    <MessageSquare size={18} strokeWidth={1.5} />
                    <h2>Conversation</h2>
                    <span className="rd-chat-count">{ticket.thread.length}</span>
                  </div>

                  <div className="rd-chat-thread">
                    {ticket.thread.length === 0 && (
                      <div className="rd-chat-empty">
                        <MessageSquare size={32} strokeWidth={1} />
                        <p>No replies yet</p>
                        <span>Reply below to respond to this ticket</span>
                      </div>
                    )}
                    {ticket.thread.map((entry) => (
                  <div className="rd-chat-group" key={entry.id}>
                    <div className="rd-chat-msg">
                      <div className="rd-chat-avatar" style={{ background: getAvatarColor(entry.author) }}>
                        {getInitials(entry.author)}
                      </div>
                      <div className="rd-chat-body">
                        <div className="rd-chat-sender-row">
                          <span className="rd-chat-name">{entry.author}</span>
                          <span className="rd-chat-time">{formatRelativeTime(entry.createdAt)}</span>
                        </div>
                        <div className="rd-chat-bubble"><p>{entry.message}</p></div>
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={threadEndRef} />
              </div>

              <div className="rd-bottom-input-bar">
                <textarea
                  className="rd-bottom-textarea"
                  placeholder="Write a reply..."
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      submitReply();
                    }
                  }}
                  rows={1}
                  disabled={submitting}
                />
                <button
                  className="rd-bottom-send-btn"
                  onClick={submitReply}
                  disabled={submitting || !replyText.trim()}
                  aria-label="Send reply"
                >
                  <Send size={18} />
                </button>
              </div>
              {replyError && <p className="rd-bottom-error">{replyError}</p>}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default TicketDetail;
