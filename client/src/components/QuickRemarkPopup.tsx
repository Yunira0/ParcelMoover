import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare, RefreshCw, Send, X } from 'lucide-react';
import Button from './Button';
import { getOrderByTrackingId, addOrderRemark, type OrderRemark } from '../services/orders.service';
import { toBsDate } from '../utils/nepaliDate';
import './QuickRemarkPopup.css';

interface QuickRemarkPopupProps {
  orderId: string;
  trackingId: string;
  onClose: () => void;
}

const getInitials = (name: string) =>
  name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);

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
  return toBsDate(date);
};

const buildTree = (remarks: OrderRemark[]) => {
  const nodeMap: Record<string, any> = {};
  const roots: any[] = [];
  remarks.forEach((r) => { nodeMap[r.id] = { ...r, children: [] }; });
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

const QuickRemarkPopup: React.FC<QuickRemarkPopupProps> = ({ orderId, trackingId, onClose }) => {
  const [remarks, setRemarks] = useState<OrderRemark[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [replyText, setReplyText] = useState('');
  const [replySubmitting, setReplySubmitting] = useState(false);
  const [replyError, setReplyError] = useState('');

  const [replyingTo, setReplyingTo] = useState<OrderRemark | null>(null);
  const [inlineText, setInlineText] = useState('');
  const [inlineSubmitting, setInlineSubmitting] = useState(false);
  const [inlineError, setInlineError] = useState('');

  const threadEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loadRemarks = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const res = await getOrderByTrackingId(trackingId);
      if (res?.success && res.data) {
        setRemarks(res.data.remarks || []);
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load remarks');
    } finally {
      setLoading(false);
    }
  }, [trackingId]);

  useEffect(() => { loadRemarks(); }, [loadRemarks]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [remarks]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const submitReply = async () => {
    const trimmed = replyText.trim();
    if (!trimmed) return;
    setReplySubmitting(true);
    setReplyError('');
    try {
      const parentId = replyingTo?.id || undefined;
      await addOrderRemark(orderId, trimmed, parentId);
      setReplyText('');
      setReplyingTo(null);
      setInlineText('');
      await loadRemarks(true);
    } catch (err: any) {
      setReplyError(err.response?.data?.message || 'Failed to post.');
    } finally {
      setReplySubmitting(false);
    }
  };

  const openInlineReply = (remark: OrderRemark) => {
    setReplyingTo(remark);
    setInlineText('');
    setInlineError('');
  };

  const cancelReply = () => {
    setReplyingTo(null);
    setInlineText('');
  };

  const submitInlineReply = async () => {
    if (!replyingTo) return;
    const trimmed = inlineText.trim();
    if (!trimmed) return;
    setInlineSubmitting(true);
    setInlineError('');
    try {
      await addOrderRemark(orderId, trimmed, replyingTo.id);
      setInlineText('');
      setReplyingTo(null);
      await loadRemarks(true);
    } catch (err: any) {
      setInlineError(err.response?.data?.message || 'Failed to post.');
    } finally {
      setInlineSubmitting(false);
    }
  };

  const remarkTree = buildTree(remarks);

  const RemarkNode: React.FC<{
    node: OrderRemark & { children: any[] };
    depth?: number;
  }> = ({ node, depth = 0 }) => {
    const hasChildren = node.children.length > 0;
    const isMaxDepth = depth >= 3;

    return (
      <div className={`qr-remark-group ${depth > 0 ? 'qr-remark-group-nested' : ''}`}>
        <div className={`qr-remark-msg ${depth > 0 ? 'qr-remark-msg-reply' : ''}`}>
          <div
            className="qr-remark-avatar"
            style={{ background: getAvatarColor(node.addedBy), width: depth > 0 ? 28 : 32, height: depth > 0 ? 28 : 32, fontSize: depth > 0 ? 10 : 11 }}
          >
            {getInitials(node.addedBy)}
          </div>
          <div className="qr-remark-body">
            <div className="qr-remark-meta">
              <span className="qr-remark-author">{node.addedBy}</span>
              <span className="qr-remark-time">{formatRelativeTime(node.createdAt)}</span>
            </div>
            <div className={`qr-remark-bubble ${depth > 0 ? 'qr-remark-bubble-reply' : ''}`}>
              <p>{node.remark}</p>
            </div>
            {!isMaxDepth && (
              <button className="qr-remark-reply-btn" onClick={() => openInlineReply(node)}>
                Reply
              </button>
            )}
          </div>
        </div>

        {hasChildren && (
          <div className="qr-remark-replies">
            {node.children.map((child) => (
              <RemarkNode key={child.id} node={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="qr-overlay" onClick={onClose}>
      <div className="qr-popup" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="qr-header">
          <div className="qr-header-left">
            <MessageSquare size={18} strokeWidth={1.5} />
            <h3>Remarks</h3>
            <span className="qr-tracking-id">{trackingId}</span>
          </div>
          <div className="qr-header-right">
            <button className="qr-header-btn" onClick={() => loadRemarks(true)} aria-label="Refresh">
              <RefreshCw size={16} />
            </button>
            <button className="qr-header-btn" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Thread */}
        <div className="qr-thread">
          {loading && (
            <div className="qr-loading">
              <div className="qr-skeleton" />
              <div className="qr-skeleton qr-skeleton-sm" />
            </div>
          )}

          {!loading && error && (
            <div className="qr-empty">
              <p>{error}</p>
              <Button variant="ghost" size="sm" onClick={() => loadRemarks()}>
                <RefreshCw size={14} /> Try again
              </Button>
            </div>
          )}

          {!loading && !error && remarkTree.length === 0 && (
            <div className="qr-empty">
              <MessageSquare size={32} strokeWidth={1} />
              <p>No remarks yet</p>
              <span>Start the conversation below</span>
            </div>
          )}

          {!loading && !error && remarkTree.map((node) => (
            <RemarkNode key={node.id} node={node} />
          ))}
          <div ref={threadEndRef} />
        </div>

        {/* Reply indicator */}
        {replyingTo && (
          <div className="qr-replying-to">
            <div className="qr-replying-preview">
              <span className="qr-replying-label">Replying to</span>
              <strong>{replyingTo.addedBy}</strong>
              <span className="qr-replying-snippet">
                {replyingTo.remark.length > 40 ? replyingTo.remark.slice(0, 40) + '...' : replyingTo.remark}
              </span>
            </div>
            <button className="qr-replying-close" onClick={cancelReply} aria-label="Cancel reply">
              <X size={14} />
            </button>
          </div>
        )}

        {/* Compose */}
        <div className="qr-compose">
          {replyingTo ? (
            <div className="qr-inline-compose">
              <textarea
                ref={textareaRef}
                className="qr-textarea"
                placeholder={`Reply to ${replyingTo.addedBy}...`}
                value={inlineText}
                onChange={(e) => setInlineText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    submitInlineReply();
                  }
                }}
                rows={2}
                autoFocus
                disabled={inlineSubmitting}
              />
              <div className="qr-compose-actions">
                <span className="qr-hint">Ctrl+Enter to reply</span>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={submitInlineReply}
                  disabled={inlineSubmitting || !inlineText.trim()}
                >
                  <Send size={14} />
                  {inlineSubmitting ? 'Posting...' : 'Reply'}
                </Button>
              </div>
              {inlineError && <p className="qr-error">{inlineError}</p>}
            </div>
          ) : (
            <div className="qr-main-compose">
              <textarea
                ref={textareaRef}
                className="qr-textarea"
                placeholder="Write a remark..."
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    submitReply();
                  }
                }}
                rows={2}
                disabled={replySubmitting}
              />
              <div className="qr-compose-actions">
                <span className="qr-hint">Ctrl+Enter to post</span>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={submitReply}
                  disabled={replySubmitting || !replyText.trim()}
                >
                  <Send size={14} />
                  {replySubmitting ? 'Posting...' : 'Reply'}
                </Button>
              </div>
              {replyError && <p className="qr-error">{replyError}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default QuickRemarkPopup;
