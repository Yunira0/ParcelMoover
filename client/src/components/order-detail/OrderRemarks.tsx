import React, { useRef, useEffect } from 'react';
import { MessageSquare, Reply } from 'lucide-react';
import type { OrderRemark } from '../../services/orders.service';
import { toBsDate } from '../../utils/nepaliDate';

interface OrderRemarksProps {
  remarks: OrderRemark[];
  onReply: (remark: OrderRemark) => void;
  highlightedRemarkId?: string | null;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function getAvatarColor(name: string): string {
  const colors = [
    '#6366f1', '#8b5cf6', '#a855f7', '#ec4899',
    '#14b8a6', '#f59e0b', '#3b82f6', '#10b981',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function formatTime(dateStr: string): string {
  if (!dateStr) return '';
  // Server sends date-only strings like "2024-01-15" (no time component)
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return toBsDate(dateStr);
  }
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return toBsDate(date);
}

const OrderRemarks: React.FC<OrderRemarksProps> = ({ remarks, onReply, highlightedRemarkId }) => {
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [remarks.length]);

  const rootRemarks = remarks.filter((r) => !r.parentRemarkId);
  const childMap = new Map<string, OrderRemark[]>();
  remarks.forEach((r) => {
    if (r.parentRemarkId) {
      const existing = childMap.get(r.parentRemarkId) || [];
      existing.push(r);
      childMap.set(r.parentRemarkId, existing);
    }
  });

  const renderMessage = (remark: OrderRemark, isReply = false) => {
    const isHighlighted = remark.id === highlightedRemarkId;
    return (
      <div
        key={remark.id}
        className={`od-chat-msg${isReply ? ' od-chat-msg-reply' : ''}${isHighlighted ? ' od-chat-msg-highlight' : ''}`}
      >
        {!isReply && (
          <div
            className="od-chat-avatar"
            style={{ background: getAvatarColor(remark.addedBy) }}
            aria-hidden="true"
          >
            {getInitials(remark.addedBy)}
          </div>
        )}
        <div className="od-chat-body">
          <div className="od-chat-sender-row">
            <span className="od-chat-name">{remark.addedBy}</span>
            <span className="od-chat-time">{formatTime(remark.createdAt)}</span>
          </div>
          <div className={`od-chat-bubble${remark.parentRemarkId ? ' od-chat-bubble-reply' : ''}`}>
            <p>{remark.remark}</p>
          </div>
          {!isReply && (
            <div className="od-chat-actions">
              <button
                className="od-chat-reply-btn"
                onClick={() => onReply(remark)}
                aria-label={`Reply to ${remark.addedBy}`}
              >
                <Reply size={11} />
                Reply
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderThread = (remark: OrderRemark, depth = 0) => {
    const children = childMap.get(remark.id) || [];
    return (
      <React.Fragment key={remark.id}>
        {renderMessage(remark, depth > 0)}
        {children.length > 0 && depth === 0 && (
          <div className="od-chat-replies">
            {children.map((child) => renderMessage(child, true))}
          </div>
        )}
      </React.Fragment>
    );
  };

  return (
    <>
      {remarks.length === 0 ? (
        <div className="od-chat-empty">
          <div className="od-chat-empty-icon">
            <MessageSquare size={20} strokeWidth={1.5} />
          </div>
          <p>No remarks yet</p>
          <span>Start the conversation below.</span>
        </div>
      ) : (
        <div className="od-chat-thread" ref={threadRef}>
          {rootRemarks.map((remark) => renderThread(remark))}
        </div>
      )}
    </>
  );
};

export default OrderRemarks;
