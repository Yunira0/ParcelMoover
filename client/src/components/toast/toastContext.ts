import { createContext, useContext, type ReactNode } from 'react';

export type ToastTone = 'success' | 'error' | 'warning';

export interface ToastApi {
  show: (tone: ToastTone, message: ReactNode) => void;
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
