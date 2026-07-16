import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BS_MONTHS,
  adDayToBsParts,
  bsDaysInMonth,
  bsToAdDay,
  bsWeekday,
  todayBsParts,
} from '../utils/nepaliDate';
import './NepaliDatePicker.css';

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;

type Props = {
  /** Selected day as an AD "YYYY-MM-DD" string (Nepal-local), or '' when unset. */
  value: string;
  /** Emits the picked day as an AD "YYYY-MM-DD" string, or '' when cleared. */
  onChange: (adDay: string) => void;
  /** Earliest selectable day, as an AD "YYYY-MM-DD" string. */
  min?: string;
  /** Latest selectable day, as an AD "YYYY-MM-DD" string. */
  max?: string;
  className?: string;
  placeholder?: string;
  'aria-label'?: string;
};

/**
 * A date picker that reads and writes AD "YYYY-MM-DD" strings (matching the
 * native <input type="date"> contract) but presents the calendar entirely in
 * BS (Bikram Sambat), so filters and displayed dates stay in the same calendar.
 */
export default function NepaliDatePicker({
  value,
  onChange,
  min,
  max,
  className,
  placeholder = 'Select date',
  'aria-label': ariaLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => adDayToBsParts(value), [value]);

  // The month the calendar grid is showing. Follows the selection, else today.
  const [view, setView] = useState(() => {
    const base = adDayToBsParts(value) ?? todayBsParts();
    return { year: base.year, monthIndex: base.monthIndex };
  });

  const openPopup = () => {
    // Jump the grid to the selected month (or today) each time it opens.
    const base = adDayToBsParts(value) ?? todayBsParts();
    setView({ year: base.year, monthIndex: base.monthIndex });
    setOpen(true);
  };

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const label = selected
    ? `${selected.year}-${String(selected.monthIndex + 1).padStart(2, '0')}-${String(selected.day).padStart(2, '0')}`
    : '';

  const days = bsDaysInMonth(view.year, view.monthIndex);
  const leadingBlanks = bsWeekday(view.year, view.monthIndex, 1);

  const shiftMonth = (delta: number) => {
    setView(prev => {
      let m = prev.monthIndex + delta;
      let y = prev.year;
      while (m < 0) { m += 12; y -= 1; }
      while (m > 11) { m -= 12; y += 1; }
      return { year: y, monthIndex: m };
    });
  };

  const pick = (day: number) => {
    onChange(bsToAdDay(view.year, view.monthIndex, day));
    setOpen(false);
  };

  const clear = () => {
    onChange('');
    setOpen(false);
  };

  const today = todayBsParts();

  return (
    <div className={`ndp-root${className ? ` ${className}` : ''}`} ref={rootRef}>
      <button
        type="button"
        className="ndp-trigger"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openPopup())}
      >
        <span className={label ? 'ndp-value' : 'ndp-placeholder'}>{label || placeholder}</span>
        <svg className="ndp-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="3" y="4.5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.6" />
          <path d="M3 9h18M8 3v3M16 3v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div className="ndp-popup" role="dialog" aria-label="Choose a BS date">
          <div className="ndp-head">
            <button type="button" className="ndp-nav" aria-label="Previous month" onClick={() => shiftMonth(-1)}>‹</button>
            <span className="ndp-title">{BS_MONTHS[view.monthIndex]} {view.year}</span>
            <button type="button" className="ndp-nav" aria-label="Next month" onClick={() => shiftMonth(1)}>›</button>
          </div>

          <div className="ndp-weekdays">
            {WEEKDAYS.map(d => <span key={d} className="ndp-weekday">{d}</span>)}
          </div>

          <div className="ndp-grid">
            {Array.from({ length: leadingBlanks }).map((_, i) => (
              <span key={`b${i}`} className="ndp-blank" />
            ))}
            {Array.from({ length: days }).map((_, i) => {
              const day = i + 1;
              const ad = bsToAdDay(view.year, view.monthIndex, day);
              const disabled = (min && ad < min) || (max && ad > max);
              const isSelected =
                selected &&
                selected.year === view.year &&
                selected.monthIndex === view.monthIndex &&
                selected.day === day;
              const isToday =
                today.year === view.year &&
                today.monthIndex === view.monthIndex &&
                today.day === day;
              return (
                <button
                  key={day}
                  type="button"
                  className={`ndp-day${isSelected ? ' ndp-day--selected' : ''}${isToday ? ' ndp-day--today' : ''}`}
                  disabled={!!disabled}
                  onClick={() => pick(day)}
                >
                  {day}
                </button>
              );
            })}
          </div>

          <div className="ndp-foot">
            <button
              type="button"
              className="ndp-foot-btn"
              disabled={(min && bsToAdDay(today.year, today.monthIndex, today.day) < min) ||
                        (max && bsToAdDay(today.year, today.monthIndex, today.day) > max) || undefined}
              onClick={() => {
                onChange(bsToAdDay(today.year, today.monthIndex, today.day));
                setOpen(false);
              }}
            >
              Today
            </button>
            <button type="button" className="ndp-foot-btn" onClick={clear}>Clear</button>
          </div>
        </div>
      )}
    </div>
  );
}
