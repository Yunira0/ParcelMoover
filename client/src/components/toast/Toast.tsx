import { useEffect } from 'react';
import { useToast, type ToastTone } from './toastContext';

interface ToastProps {
  tone: ToastTone;
  /** Pops whenever this changes to a non-empty value. */
  message: string | null | undefined;
  /** Called once it has popped - usually clears the page's message state. */
  onShown?: () => void;
}

// Drop-in for an inline success/error/warning message: put it where the
// message used to render and it pops at the top of the screen instead.
export default function Toast({ tone, message, onShown }: ToastProps) {
  const { show } = useToast();

  useEffect(() => {
    if (!message) return;
    show(tone, message);
    onShown?.();
    // Keyed on the message; onShown is usually an inline arrow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message, tone, show]);

  return null;
}
