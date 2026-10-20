import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, X, XCircle } from 'lucide-react';
import type { ToastTone } from './toastContext';

const DURATION_MS: Record<ToastTone, number> = { success: 4000, error: 6000, warning: 6000 };

const ICONS: Record<ToastTone, ReactNode> = {
  success: <CheckCircle2 size={18} />,
  error: <XCircle size={18} />,
  warning: <AlertTriangle size={18} />,
};

interface ToastCardProps {
  tone: ToastTone;
  message: ReactNode;
  onClose: () => void;
}

// One popup. Hides itself after a few seconds; hovering keeps it open.
export default function ToastCard({ tone, message, onClose }: ToastCardProps) {
  const [paused, setPaused] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(() => closeRef.current(), DURATION_MS[tone]);
    return () => clearTimeout(timer);
  }, [paused, tone]);

  return (
    <div
      className={`toast toast--${tone}`}
      role={tone === 'success' ? 'status' : 'alert'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <span className="toast-icon" aria-hidden="true">{ICONS[tone]}</span>
      <div className="toast-message">{message}</div>
      <button type="button" className="toast-close" onClick={onClose} aria-label="Dismiss">
        <X size={16} />
      </button>
    </div>
  );
}
