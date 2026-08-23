import React, { useEffect } from 'react';
import './tally.css';

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
  actions?: TallyAction[];
  /** Filter controls, rendered in a strip above the sheet. */
  filters?: React.ReactNode;
  error?: unknown;
  loading?: boolean;
  children: React.ReactNode;
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
  actions = [],
  filters,
  error,
  loading = false,
  children,
}) => {
  useEffect(() => {
    if (actions.length === 0) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      // Never steal a key from someone who is typing. Tally has no text fields
      // competing for F-keys; a web page does.
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      const action = actions.find((candidate) => candidate.key === event.key);
      if (!action || action.disabled) return;
      event.preventDefault();
      action.onSelect();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [actions]);

  const message = errorText(error);

  return (
    <div className="tly">
      <div className="tly-main">
        <div className="tly-titlebar">
          <h1 className="tly-title">{title}</h1>
          {period && <span className="tly-period">{period}</span>}
        </div>

        {filters && <div className="tly-filters">{filters}</div>}

        {message && <p className="tly-note tly-note-danger">{message}</p>}

        {loading ? <p className="tly-note">Loading…</p> : children}
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
              <kbd>{action.key}</kbd>
              <span>{action.label}</span>
            </button>
          ))}
        </nav>
      )}
    </div>
  );
};

export default TallyPage;
