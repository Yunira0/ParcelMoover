import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import ToastCard from './ToastCard';
import { ToastContext, type ToastApi, type ToastOptions, type ToastTone } from './toastContext';
import './toast.css';

interface ToastItem {
  id: number;
  tone: ToastTone;
  message: ReactNode;
  sticky: boolean;
}

const MAX_VISIBLE = 3;
// StrictMode re-runs effects on mount, so the same message can arrive twice.
const DEDUPE_MS = 1000;

// Holds the popups and renders them at the top of the screen.
export default function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const last = useRef({ key: '', at: 0 });

  const close = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((tone: ToastTone, message: ReactNode, options: ToastOptions = {}) => {
    if (message == null || message === '') return undefined;
    const sticky = Boolean(options.sticky);
    // Sticky toasts are removed by their owner on cleanup, so they skip dedupe.
    const key = !sticky && typeof message === 'string' ? `${tone}:${message}` : '';
    const now = Date.now();
    if (key && key === last.current.key && now - last.current.at < DEDUPE_MS) return undefined;
    last.current = { key, at: now };
    const id = nextId.current++;
    setItems((prev) => [...prev, { id, tone, message, sticky }].slice(-MAX_VISIBLE));
    return id;
  }, []);

  const api = useMemo<ToastApi>(() => ({
    show,
    dismiss: close,
    success: (m) => show('success', m),
    error: (m) => show('error', m),
    warning: (m) => show('warning', m),
  }), [show, close]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="toast-viewport">
          {items.map((item) => (
            <ToastCard key={item.id} tone={item.tone} message={item.message} sticky={item.sticky} onClose={() => close(item.id)} />
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}
