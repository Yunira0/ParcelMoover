import React, { useEffect } from 'react';
import { keyLabel } from './tallyKeys';
import './tally.css';
import './tallyVoucher.css';

/**
 * One action in the right-hand panel.
 *
 * `key` is the function key that triggers it — the label and the binding come
 * from the same object deliberately, so a screen cannot show F5 and listen for
 * F6.
 */
export interface TallyAction {
  key: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  /**
   * The one action the screen exists for, if it has one. It takes the brand
   * colour so it reads as the primary action the rest of the app would give
   * it - at most one per screen, or the panel stops having a focal point.
   */
  primary?: boolean;
}

interface TallyPageProps {
  title: string;
  /** The period or scope this screen is showing, e.g. "1 Shrawan – 31 Shrawan 2083". */
  period?: string;
  /** Caption above the period. Omitted when `period` is not a window - the
   *  vouchers pass a date and Masters a count. */
  periodLabel?: string;
  actions?: TallyAction[];
  /** Filter controls, rendered in a strip above the sheet. */
  filters?: React.ReactNode;
  error?: unknown;
  loading?: boolean;
  /** Repeat the actions as a menu line under the sheet, as Tally's reports do. */
  menu?: boolean;
  children: React.ReactNode;
}

/**
 * The key as an action names it: "F5", "Escape", or a combination such as
 * "Alt+P" / "Ctrl+A". Letters come from `code`, so Alt+P is still P on a
 * layout where Alt changes the character typed.
 */
function comboOf(event: KeyboardEvent): string {
  const base = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3) : event.key === 'Enter' ? 'Enter' : event.key;
  return `${event.ctrlKey || event.metaKey ? 'Ctrl+' : ''}${event.altKey ? 'Alt+' : ''}${event.shiftKey ? 'Shift+' : ''}${base}`;
}

/** Pulls a readable message out of whatever the caller caught. */
function errorText(error: unknown): string | null {
  if (!error) return null;
  if (typeof error === 'string') return error;
  const response = (error as { response?: { data?: { message?: string } } }).response;
  return response?.data?.message ?? (error as Error).message ?? 'Something went wrong.';
}

/**
 * The accounting work area: title strip, optional filters, the sheet, and the
 * fixed panel of keyed actions on the right.
 *
 * The panel is the reason this is a component rather than a stylesheet. Its
 * whole value is that F5 is in the same place and does the same kind of thing
 * on every screen, and that only holds if one place owns both the rendering and
 * the key binding.
 */
const TallyPage: React.FC<TallyPageProps> = ({
  title,
  period,
  periodLabel,
  actions = [],
  filters,
  error,
  loading = false,
  menu = false,
  children,
}) => {
  useEffect(() => {
    if (actions.length === 0) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      // A dialog on top owns the keyboard: Esc closes it, not the screen.
      if (document.querySelector('.modal-overlay')) return;
      const combo = comboOf(event);
      const action = actions.find((candidate) => candidate.key === combo);
      // Anything this screen doesn't claim — Ctrl+F5, Ctrl+C — stays the
      // browser's.
      if (!action) return;

      // Function keys and Ctrl/Alt combinations fire even from inside a field:
      // they never type anything, and on a voucher the cursor is always in a
      // field. A bare key (Escape) still belongs to whoever is typing — it
      // closes an open dropdown before it quits the screen.
      const isFunctionKey = /^F([1-9]|1[0-2])$/.test(event.key);
      const isCombo = event.ctrlKey || event.altKey || event.metaKey;
      const target = event.target as HTMLElement | null;
      const typing = target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable);
      if (typing && !isFunctionKey && !isCombo) return;
      // Claimed even when disabled, so a greyed-out F5 doesn't fall through
      // to the browser and reload the half-filled voucher.
      event.preventDefault();
      event.stopPropagation();
      if (!action.disabled) action.onSelect();
    };

    // Capture phase, so a dropdown that stops propagation can't swallow it.
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [actions]);

  const message = errorText(error);

  return (
    <div className="tly">
      <div className="tly-main">
        <div className="tly-titlebar">
          <h1 className="tly-title">{title}</h1>
          {period &&
            (periodLabel ? (
              <div className="tly-period-box">
                <span className="tly-period-label">{periodLabel}</span>
                <strong className="tly-period-value">{period}</strong>
              </div>
            ) : (
              <span className="tly-period">{period}</span>
            ))}
        </div>

        {filters && <div className="tly-filters">{filters}</div>}

        {message && <p className="tly-note tly-note-danger">{message}</p>}

        {loading ? <p className="tly-note">Loading…</p> : children}

        {menu && actions.length > 0 && (
          <nav className="jv-menu tly-menu" aria-label="Menu">
            {actions.map((action) => (
              <button
                key={action.key}
                type="button"
                className={action.primary ? 'jv-menu-item is-primary' : 'jv-menu-item'}
                onClick={action.onSelect}
                disabled={action.disabled}
              >
                {action.label}
              </button>
            ))}
          </nav>
        )}
      </div>

      {actions.length > 0 && (
        <nav className="tly-panel" aria-label="Actions">
          <div className="tly-panel-heading">Actions</div>
          {actions.map((action) => (
            <button
              key={action.key}
              type="button"
              className={action.primary ? 'tly-key tly-key-primary' : 'tly-key'}
              onClick={action.onSelect}
              disabled={action.disabled}
            >
              <kbd>{keyLabel(action.key)}</kbd>
              <span>{action.label}</span>
            </button>
          ))}
        </nav>
      )}
    </div>
  );
};

export default TallyPage;
