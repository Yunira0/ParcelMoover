import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import ToastCard from './ToastCard';
import { ToastContext, type ToastApi, type ToastTone } from './toastContext';
import './toast.css';

interface ToastItem {
  id: number;
  tone: ToastTone;
  message: ReactNode;
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

  const show = useCallback((tone: ToastTone, message: ReactNode) => {
    if (message == null || message === '') return;
    const key = typeof message === 'string' ? `${tone}:${message}` : '';
    const now = Date.now();
    if (key && key === last.current.key && now - last.current.at < DEDUPE_MS) return;
    last.current = { key, at: now };
    const id = nextId.current++;
    setItems((prev) => [...prev, { id, tone, message }].slice(-MAX_VISIBLE));
  }, []);

  const api = useMemo<ToastApi>(() => ({
    show,
    success: (m) => show('success', m),
    error: (m) => show('error', m),
    warning: (m) => show('warning', m),
  }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="toast-viewport">
          {items.map((item) => (
            <ToastCard key={item.id} tone={item.tone} message={item.message} onClose={() => close(item.id)} />
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}
