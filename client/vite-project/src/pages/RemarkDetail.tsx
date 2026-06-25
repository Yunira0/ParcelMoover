import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, MessageSquare, Package, Phone, RefreshCw, RotateCcw, Send, User, X } from 'lucide-react';
import Button from '../components/Button';
import StatusChip, { type StatusChipTone } from '../components/StatusChip';
import {
  getRemarkById,
  setRemarkStatus,
  REMARK_STATUS_LABELS,
  type RemarkDetail as RemarkDetailType,
  type RemarkThreadEntry,
  type RemarkStatus,
} from '../services/remarks.service';
import { addOrderRemark } from '../services/orders.service';
import './RemarkDetail.css';
import './TicketDetail.css';

const STATUS_TONE: Record<RemarkStatus, StatusChipTone> = {
  open: 'info',
  pending: 'warning',
  closed: 'success',
};

const getInitials = (name: string) => name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);

const getAvatarColor = (name: string) => {
  const lower = name.toLowerCase();
  if (lower.includes('admin') || lower.includes('super')) return '#c2410c';
  if (lower.includes('vendor') || lower.includes('branch')) return '#0f766e';
  if (lower.includes('rider')) return '#16a34a';
  return '#64748b';
};

const formatRelativeTime = (dateStr: string) => {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { dateStyle: 'medium' });
};

const buildTree = (thread: RemarkThreadEntry[]) => {
  const nodeMap: Record<string, any> = {};
  const roots: any[] = [];
  thread.forEach((r) => { nodeMap[r.id] = { ...r, children: [] }; });
  thread.forEach((r) => {
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

const RemarkDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [remark, setRemark] = useState<RemarkDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusUpdating, setStatusUpdating] = useState(false);

  const [bottomText, setBottomText] = useState('');
  const [bottomSubmitting, setBottomSubmitting] = useState(false);
  const [bottomError, setBottomError] = useState('');

  const [replyingTo, setReplyingTo] = useState<RemarkThreadEntry | null>(null);
  const [inlineText, setInlineText] = useState('');
  const [inlineSubmitting, setInlineSubmitting] = useState(false);
  const [inlineError, setInlineError] = useState('');

  const bottomInputRef = useRef<HTMLTextAreaElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);

  const loadRemark = useCallback(async (silent = false) => {
    if (!id) return;
    if (!silent) setLoading(true);
    setError('');
    try {
      const res = await getRemarkById(id);
      if (res?.success && res.data) {
        setRemark(res.data);
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load remark');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadRemark(); }, [loadRemark]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [remark]);

  const submitBottomReply = async () => {
    if (!remark) return;
    const trimmed = bottomText.trim();
    if (!trimmed) return;
    setBottomSubmitting(true);
    setBottomError('');
    try {
      const parentId = replyingTo?.id || undefined;
      await addOrderRemark(remark.parcelId, trimmed, parentId);
      // Replying resolves the remark.
      await setRemarkStatus(remark.id, 'closed');
      setBottomText('');
      setReplyingTo(null);
      setInlineText('');
      await loadRemark(true);
    } catch (err: any) {
      setBottomError(err.response?.data?.message || 'Failed to post.');
    } finally {
      setBottomSubmitting(false);
    }
  };

  const openInlineReply = (entry: RemarkThreadEntry) => {
    setReplyingTo(entry);
    setInlineText('');
    setInlineError('');
    bottomInputRef.current?.focus();
  };

  const cancelReply = () => {
    setReplyingTo(null);
    setInlineText('');
  };

  const submitInlineReply = async () => {
    if (!remark || !replyingTo) return;
    const trimmed = inlineText.trim();
    if (!trimmed) return;
    setInlineSubmitting(true);
    setInlineError('');
    try {
      await addOrderRemark(remark.parcelId, trimmed, replyingTo.id);
      await setRemarkStatus(remark.id, 'closed');
      setInlineText('');
      setReplyingTo(null);
      await loadRemark(true);
    } catch (err: any) {
      setInlineError(err.response?.data?.message || 'Failed to post.');
    } finally {
      setInlineSubmitting(false);
    }
  };

  const changeStatus = async (status: RemarkStatus) => {
    if (!remark) return;
    setStatusUpdating(true);
    try {
      await setRemarkStatus(remark.id, status);
      await loadRemark(true);
    } finally {
      setStatusUpdating(false);
    }
  };

  const remarkTree = remark ? buildTree(remark.thread) : [];

  const RemarkNode: React.FC<{
    node: RemarkThreadEntry & { children: any[] };
    depth?: number;
  }> = ({ node, depth = 0 }) => {
    const hasChildren = node.children.length > 0;
    const isMaxDepth = depth >= 3;

    return (
      <div className={`rd-chat-group ${depth > 0 ? 'rd-chat-group-nested' : ''}`}>
        <div className={`rd-chat-msg ${depth > 0 ? 'rd-chat-msg-reply' : ''}`}>
          <div
            className="rd-chat-avatar"
            style={{ background: getAvatarColor(node.addedBy), width: depth > 0 ? 28 : 36, height: depth > 0 ? 28 : 36, fontSize: depth > 0 ? 10 : 12 }}
          >
            {getInitials(node.addedBy)}
          </div>
          <div className="rd-chat-body">
            <div className="rd-chat-sender-row">
              <span className="rd-chat-name">{node.addedBy}</span>
              <span className="rd-chat-time">{formatRelativeTime(node.createdAt)}</span>
            </div>
            <div className={`rd-chat-bubble ${depth > 0 ? 'rd-chat-bubble-reply' : ''}`}>
              <p>{node.remark}</p>
            </div>
            {!isMaxDepth && (
              <button className="rd-chat-reply-btn" onClick={() => openInlineReply(node)}>
                Reply
              </button>
            )}
          </div>
        </div>

        {hasChildren && (
          <div className="rd-chat-replies">
            {node.children.map((child) => (
              <RemarkNode key={child.id} node={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="page-container">
      <div className="page-content">
        {/* Back navigation */}
        <button className="back-link" onClick={() => navigate(-1)}>
          <ArrowLeft size={16} />
          Back
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
            <h3>Remark not found</h3>
            <p>{error}</p>
            <Button variant="primary" onClick={() => loadRemark()}>
              <RefreshCw size={16} />
              Try again
            </Button>
          </div>
        )}

        {!loading && remark && (
          <>
            {/* Header */}
            <div className="detail-header">
              <div className="detail-header-main">
                <div className="tracking-row">
                  <h1 className="tracking-id">{remark.remarkId}</h1>
                  <StatusChip tone={STATUS_TONE[remark.status]}>
                    {REMARK_STATUS_LABELS[remark.status]}
                  </StatusChip>
                </div>
                <Link to={`/orders/track/${remark.trackingId}`} className="tracking-link">
                  <Package size={14} strokeWidth={1.5} />
                  {remark.trackingId}
                </Link>
              </div>
              <div className="detail-header-actions">
                {remark.status !== 'closed' ? (
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

            {/* Info cards */}
            <div className="info-grid">
              <div className="info-card">
                <div className="info-card-header">
                  <User size={16} strokeWidth={1.5} />
                  <span>Sender</span>
                </div>
                <p className="info-name">{remark.senderName}</p>
                <p className="info-detail">
                  <Phone size={14} strokeWidth={1.5} /> {remark.senderPhone}
                </p>
              </div>

              <div className="info-card">
                <div className="info-card-header">
                  <User size={16} strokeWidth={1.5} />
                  <span>Receiver</span>
                </div>
                <p className="info-name">{remark.receiverName}</p>
                <p className="info-detail">
                  <Phone size={14} strokeWidth={1.5} /> {remark.receiverPhone}
                </p>
              </div>
            </div>

            {/* Conversation Thread - Chat style */}
            <div className="rd-chat-section">
              <div className="rd-chat-header">
                <MessageSquare size={18} strokeWidth={1.5} />
                <h2>Conversation</h2>
                <span className="rd-chat-count">{remark.thread.length}</span>
              </div>

              <div className="rd-chat-thread">
                {remarkTree.length === 0 ? (
                  <div className="rd-chat-empty">
                    <MessageSquare size={32} strokeWidth={1} />
                    <p>No remarks yet</p>
                    <span>Start the conversation below</span>
                  </div>
                ) : (
                  remarkTree.map((node) => (
                    <RemarkNode key={node.id} node={node} />
                  ))
                )}
                <div ref={threadEndRef} />
              </div>

              {/* Reply indicator */}
              {replyingTo && (
                <div className="rd-bottom-replying-to">
                  <div className="rd-bottom-replying-preview">
                    <span className="rd-bottom-replying-label">Replying to</span>
                    <strong>{replyingTo.addedBy}</strong>
                    <span className="rd-bottom-replying-snippet">
                      {replyingTo.remark.length > 40 ? replyingTo.remark.slice(0, 40) + '...' : replyingTo.remark}
                    </span>
                  </div>
                  <button className="rd-bottom-replying-close" onClick={cancelReply} aria-label="Cancel reply">
                    <X size={14} />
                  </button>
                </div>
              )}

              {/* Bottom compose */}
              <div className="rd-bottom-input-bar">
                <textarea
                  ref={bottomInputRef}
                  className="rd-bottom-textarea"
                  placeholder={replyingTo ? `Reply to ${replyingTo.addedBy}...` : 'Write a remark...'}
                  value={replyingTo ? inlineText : bottomText}
                  onChange={(e) => replyingTo ? setInlineText(e.target.value) : setBottomText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      replyingTo ? submitInlineReply() : submitBottomReply();
                    }
                  }}
                  rows={1}
                  disabled={replyingTo ? inlineSubmitting : bottomSubmitting}
                />
                <button
                  className="rd-bottom-send-btn"
                  onClick={replyingTo ? submitInlineReply : submitBottomReply}
                  disabled={replyingTo ? (inlineSubmitting || !inlineText.trim()) : (bottomSubmitting || !bottomText.trim)}
                  aria-label="Send"
                >
                  <Send size={18} />
                </button>
              </div>
              {(bottomError || inlineError) && (
                <p className="rd-bottom-error">{bottomError || inlineError}</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default RemarkDetail;
