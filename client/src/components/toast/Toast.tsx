import { useEffect } from 'react';
import { useToast, type ToastTone } from './toastContext';

interface ToastProps {
  tone: ToastTone;
  /** Pops whenever this changes to a non-empty value. */
  message: string | null | undefined;
  /** Called once it has popped - usually clears the page's message state. */
  onShown?: () => void;
  /** Stays open until dismissed; closes on its own once `message` clears. */
  sticky?: boolean;
}

// Drop-in for an inline success/error/warning message: put it where the
// message used to render and it pops at the top of the screen instead.
export default function Toast({ tone, message, onShown, sticky }: ToastProps) {
  const { show, dismiss } = useToast();

  useEffect(() => {
    if (!message) return;
    const id = show(tone, message, { sticky });
    onShown?.();
    return sticky && id !== undefined ? () => dismiss(id) : undefined;
    // Keyed on the message; onShown is usually an inline arrow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message, tone, sticky, show, dismiss]);

  return null;
}
