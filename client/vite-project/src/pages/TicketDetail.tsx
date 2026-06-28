import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, MessageSquare, RefreshCw, RotateCcw, Send, Tag, User } from 'lucide-react';
import Button from '../components/Button';
import StatusChip, { type StatusChipTone } from '../components/StatusChip';
import {
  getTicketById,
  replyToTicket,
  setTicketStatus,
  TICKET_CATEGORY_LABELS,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
  type TicketDetail as TicketDetailType,
} from '../services/tickets.service';
import './RemarkDetail.css';
import './TicketDetail.css';

const STATUS_TONE: Record<TicketDetailType['status'], StatusChipTone> = {
  open: 'info',
  pending: 'warning',
  closed: 'success',
};

const getInitials = (name: string) => name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);

const getAvatarColor = (name: string) => {
  const lower = name.toLowerCase();
  if (lower.includes('admin') || lower.includes('super')) return '#c2410c';
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
  return date.toLocaleDateString(undefined, { dateStyle: 'medium' });
};

const TicketDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
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
      if (res?.success && res.data) setTicket(res.data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load ticket');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadTicket(); }, [loadTicket]);
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
                </div>
                <p className="tracking-link">{ticket.subject}</p>
              </div>
              <div className="detail-header-actions">
                {ticket.status !== 'closed' ? (
                  <Button variant="primary" onClick={() => changeStatus('closed')} disabled={statusUpdating}>
                    <CheckCircle2 size={16} /> Mark as Done
                  </Button>
                ) : (
                  <Button variant="secondary" onClick={() => changeStatus('open')} disabled={statusUpdating}>
                    <RotateCcw size={16} /> Reopen
                  </Button>
                )}
              </div>
            </div>

            <div className="info-grid">
              <div className="info-card">
                <div className="info-card-header">
                  <User size={16} strokeWidth={1.5} />
                  <span>Customer</span>
                </div>
                <p className="info-name">{ticket.customerName || '—'}</p>
                <p className="info-detail">{ticket.customerPhone || '—'}</p>
              </div>
              <div className="info-card">
                <div className="info-card-header">
                  <Tag size={16} strokeWidth={1.5} />
                  <span>Category / Priority</span>
                </div>
                <p className="info-name">{TICKET_CATEGORY_LABELS[ticket.category]}</p>
                <p className="info-detail">{TICKET_PRIORITY_LABELS[ticket.priority]} priority</p>
              </div>
            </div>

            <div className="rd-chat-section">
              <div className="rd-chat-header">
                <MessageSquare size={18} strokeWidth={1.5} />
                <h2>Conversation</h2>
                <span className="rd-chat-count">{ticket.thread.length}</span>
              </div>

              <div className="rd-chat-thread">
                {/* Original ticket message as the opening entry */}
                {ticket.description && (
                  <div className="rd-chat-group">
                    <div className="rd-chat-msg">
                      <div className="rd-chat-avatar" style={{ background: getAvatarColor(ticket.customerName || 'C') }}>
                        {getInitials(ticket.customerName || 'Customer')}
                      </div>
                      <div className="rd-chat-body">
                        <div className="rd-chat-sender-row">
                          <span className="rd-chat-name">{ticket.customerName || 'Customer'}</span>
                          <span className="rd-chat-time">{ticket.createdAt}</span>
                        </div>
                        <div className="rd-chat-bubble"><p>{ticket.description}</p></div>
                      </div>
                    </div>
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
          </>
        )}
      </div>
    </div>
  );
};

export default TicketDetail;
