import React, { useEffect, useState, useRef, useCallback } from 'react';
import { CornerDownRight, Send, X, AlertCircle, MessageSquare, Check } from 'lucide-react';
import Button from './Button';
import {
  createOrderRemark,
  getOrderRemarks,
  replyToOrderRemark,
  type Remark,
} from '../services/orders.service';
import './Modal.css';
import './RemarksModal.css';

interface RemarksModalProps {
  orderId: string;
  trackingId: string;
  isOpen: boolean;
  onClose: () => void;
  onChanged?: () => void;
}

const MAX_CHARS = 2000;

const formatTimestamp = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

const getInitials = (name: string) => {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
};

const getAvatarClass = (authorName: string) => {
  const lower = authorName.toLowerCase();
  if (lower.includes('admin')) return 'admin';
  if (lower.includes('vendor')) return 'vendor';
  if (lower.includes('rider')) return 'rider';
  return 'user';
};

const getRoleBadge = (authorName: string) => {
  const lower = authorName.toLowerCase();
  if (lower.includes('admin')) return { class: 'admin', label: 'Admin' };
  if (lower.includes('vendor')) return { class: 'vendor', label: 'Vendor' };
  if (lower.includes('rider')) return { class: 'rider', label: 'Rider' };
  return null;
};

const RemarksModal: React.FC<RemarksModalProps> = ({ orderId, trackingId, isOpen, onClose, onChanged }) => {
  const [remarks, setRemarks] = useState<Remark[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [newRemark, setNewRemark] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [replyTargetId, setReplyTargetId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replySubmitting, setReplySubmitting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const modalRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const replyTextareaRef = useRef<HTMLTextAreaElement>(null);

  const loadRemarks = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await getOrderRemarks(orderId);
      setRemarks(res.data || []);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load remarks');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadRemarks();
      setNewRemark('');
      setReplyTargetId(null);
      setReplyText('');
      setError('');
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [isOpen, orderId]);

  useEffect(() => {
    if (replyTargetId && replyTextareaRef.current) {
      replyTextareaRef.current.focus();
    }
  }, [replyTargetId]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    },
    [isOpen, onClose]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  if (!isOpen) return null;

  const handleAddRemark = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRemark.trim() || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await createOrderRemark(orderId, newRemark.trim());
      setNewRemark('');
      await loadRemarks();
      onChanged?.();
      showToast('Remark added successfully');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to add remark');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReply = async (remarkId: string) => {
    if (!replyText.trim() || replySubmitting) return;
    setReplySubmitting(true);
    setError('');
    try {
      await replyToOrderRemark(orderId, remarkId, replyText.trim());
      setReplyText('');
      setReplyTargetId(null);
      await loadRemarks();
      onChanged?.();
      showToast('Reply added successfully');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to add reply');
    } finally {
      setReplySubmitting(false);
    }
  };

  const handleCancelReply = () => {
    setReplyTargetId(null);
    setReplyText('');
  };

  const getCharCountClass = (count: number) => {
    if (count >= MAX_CHARS) return 'error';
    if (count >= MAX_CHARS * 0.9) return 'warning';
    return '';
  };

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="remarks-title"
    >
      <div className="modal-content remarks-modal" ref={modalRef}>
        <div className="modal-header">
          <h2 id="remarks-title">Remarks · {trackingId}</h2>
          <Button
            variant="ghost"
            size="icon"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close modal"
          >
            <X size={20} />
          </Button>
        </div>

        <form className="remarks-add-form" onSubmit={handleAddRemark}>
          <div className="remarks-textarea-wrapper">
            <textarea
              ref={textareaRef}
              className="remarks-textarea"
              value={newRemark}
              onChange={(e) => setNewRemark(e.target.value)}
              placeholder="Add a remark for this order..."
              maxLength={MAX_CHARS}
              aria-label="Add a remark"
            />
          </div>
          <div className="remarks-form-footer">
            <span className={`remarks-char-count ${getCharCountClass(newRemark.length)}`}>
              {newRemark.length}/{MAX_CHARS}
            </span>
            <Button type="submit" variant="primary" disabled={submitting || !newRemark.trim()}>
              <Send size={14} />
              {submitting ? 'Adding...' : 'Add Remark'}
            </Button>
          </div>
        </form>

        {error && (
          <div className="remarks-error" role="alert">
            <AlertCircle size={16} className="remarks-error-icon" />
            <span>{error}</span>
          </div>
        )}

        <div className="remarks-thread-list" role="list" aria-live="polite">
          {loading ? (
            <div className="remarks-loading">
              {[1, 2, 3].map((i) => (
                <div key={i} className="remark-skeleton">
                  <div className="remark-skeleton-avatar" />
                  <div className="remark-skeleton-content">
                    <div className="remark-skeleton-line short" />
                    <div className="remark-skeleton-line medium" />
                  </div>
                </div>
              ))}
            </div>
          ) : remarks.length === 0 ? (
            <div className="remarks-empty">
              <MessageSquare size={48} className="remarks-empty-icon" />
              <p className="remarks-empty-title">No remarks yet</p>
              <p className="remarks-empty-text">Be the first to add a remark for this order.</p>
            </div>
          ) : (
            remarks.map((thread) => (
              <div key={thread.id} className="remark-thread" role="listitem">
                <div className="remark-item">
                  <div className={`remark-avatar ${getAvatarClass(thread.authorName)}`}>
                    {getInitials(thread.authorName)}
                  </div>
                  <div className="remark-content">
                    <div className="remark-header">
                      <span className="remark-author">{thread.authorName}</span>
                      {getRoleBadge(thread.authorName) && (
                        <span className={`remark-role-badge ${getRoleBadge(thread.authorName)!.class}`}>
                          {getRoleBadge(thread.authorName)!.label}
                        </span>
                      )}
                      <span className="remark-time">{formatTimestamp(thread.createdAt)}</span>
                    </div>
                    <p className="remark-text">{thread.remark}</p>
                  </div>
                </div>

                <button
                  type="button"
                  className={`remark-reply-toggle ${replyTargetId === thread.id ? 'active' : ''}`}
                  onClick={() => {
                    setReplyTargetId(replyTargetId === thread.id ? null : thread.id);
                    setReplyText('');
                  }}
                  aria-expanded={replyTargetId === thread.id}
                  aria-label={replyTargetId === thread.id ? 'Cancel reply' : 'Reply to this remark'}
                >
                  <CornerDownRight size={14} />
                  {replyTargetId === thread.id ? 'Cancel' : 'Reply'}
                </button>

                {thread.replies.length > 0 && (
                  <div className="remark-replies">
                    {thread.replies.map((reply) => (
                      <div key={reply.id} className="remark-item remark-reply-item">
                        <div className={`remark-avatar ${getAvatarClass(reply.authorName)}`}>
                          {getInitials(reply.authorName)}
                        </div>
                        <div className="remark-content">
                          <div className="remark-header">
                            <span className="remark-author">{reply.authorName}</span>
                            {getRoleBadge(reply.authorName) && (
                              <span className={`remark-role-badge ${getRoleBadge(reply.authorName)!.class}`}>
                                {getRoleBadge(reply.authorName)!.label}
                              </span>
                            )}
                            <span className="remark-time">{formatTimestamp(reply.createdAt)}</span>
                          </div>
                          <p className="remark-text">{reply.remark}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className={`remark-reply-form ${replyTargetId === thread.id ? 'open' : ''}`}>
                  <div className="remark-reply-form-inner">
                    <textarea
                      ref={replyTargetId === thread.id ? replyTextareaRef : undefined}
                      className="remark-reply-textarea"
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="Write a reply..."
                      maxLength={MAX_CHARS}
                      aria-label="Write a reply"
                    />
                    <div className="remark-reply-form-footer">
                      <span className={`remark-reply-char-count ${getCharCountClass(replyText.length)}`}>
                        {replyText.length}/{MAX_CHARS}
                      </span>
                      <div className="remark-reply-actions">
                        <Button type="button" variant="ghost" size="sm" onClick={handleCancelReply}>
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          variant="primary"
                          size="sm"
                          disabled={replySubmitting || !replyText.trim()}
                          onClick={() => handleReply(thread.id)}
                        >
                          {replySubmitting ? 'Sending...' : 'Send Reply'}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="modal-footer">
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>

      {toast && (
        <div className="remarks-toast" role="status" aria-live="polite">
          <Check size={16} />
          {toast.message}
        </div>
      )}
    </div>
  );
};

export default RemarksModal;
