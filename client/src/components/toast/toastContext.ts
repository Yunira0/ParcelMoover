import { createContext, useContext, type ReactNode } from 'react';

export type ToastTone = 'success' | 'error' | 'warning';

export interface ToastOptions {
  /** Stays until dismissed instead of hiding itself. */
  sticky?: boolean;
}

export interface ToastApi {
  /** Returns the toast's id, or undefined when nothing was shown. */
  show: (tone: ToastTone, message: ReactNode, options?: ToastOptions) => number | undefined;
  dismiss: (id: number) => void;
  success: (message: ReactNode) => void;
  error: (message: ReactNode) => void;
  warning: (message: ReactNode) => void;
}

export const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
