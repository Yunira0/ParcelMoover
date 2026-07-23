import React, { useState, useRef, useEffect } from 'react';
import { Send, X, AlertCircle } from 'lucide-react';
import type { OrderRemark } from '../../services/orders.service';

interface OrderRemarkInputProps {
  onSubmit: (remark: string, parentRemarkId?: string | null) => Promise<void>;
  replyingTo: OrderRemark | null;
  onCancelReply: () => void;
}

const OrderRemarkInput: React.FC<OrderRemarkInputProps> = ({
  onSubmit,
  replyingTo,
  onCancelReply,
}) => {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (replyingTo && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [replyingTo]);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    setError(null);
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 100)}px`;
  };

  const handleSubmit = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    setSending(true);
    setError(null);
    try {
      await onSubmit(trimmed, replyingTo?.id ?? null);
      setText('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    } catch {
      setError('Failed to send remark. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="od-bottom-input-area">
      <div className="od-bottom-input-bar">
        {replyingTo && (
          <div className="od-bottom-replying-to">
            <div className="od-bottom-replying-preview">
              <span className="od-bottom-replying-label">Replying to</span>
              <strong>{replyingTo.addedBy}</strong>
              <span className="od-bottom-replying-snippet">{replyingTo.remark}</span>
            </div>
            <button
              className="od-bottom-replying-close"
              onClick={onCancelReply}
              title="Cancel reply"
              aria-label="Cancel reply"
            >
              <X size={16} strokeWidth={2.5} />
            </button>
          </div>
        )}
        <div className="od-bottom-input-wrap">
          <textarea
            ref={textareaRef}
            className="od-bottom-input"
            placeholder={replyingTo ? 'Write a reply...' : 'Add a remark...'}
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            rows={1}
            aria-label={replyingTo ? 'Reply to remark' : 'Add a remark'}
          />
          <button
            className="od-bottom-send"
            onClick={handleSubmit}
            disabled={!text.trim() || sending}
            title="Send remark"
            aria-label="Send remark"
          >
            {sending ? (
              <span className="od-bottom-send-loading" />
            ) : (
              <Send size={16} />
            )}
          </button>
        </div>
        {error && (
          <div className="od-bottom-error">
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <AlertCircle size={13} />
              {error}
            </span>
            <button
              onClick={() => setError(null)}
              style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0 }}
              aria-label="Dismiss error"
            >
              <X size={13} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default OrderRemarkInput;
