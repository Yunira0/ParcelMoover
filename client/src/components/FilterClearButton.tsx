import React from 'react';
import { X } from 'lucide-react';

interface FilterClearButtonProps {
  /** Whether the filter currently holds a value; the button only renders then. */
  active: boolean;
  onClear: () => void;
  label: string;
  /** `chevron` (default) sits left of a dropdown chevron or picker icon;
   *  `plain` sits at the right edge of a plain text input. */
  inset?: 'chevron' | 'plain';
  children: React.ReactNode;
}

/** Wraps a filter control and overlays a small remove (x) button, left of the
 * dropdown chevron, whenever the filter has a value. While active, the control
 * reserves room for it so a long value truncates before the button instead of
 * running underneath it. */
const FilterClearButton: React.FC<FilterClearButtonProps> = ({ active, onClear, label, inset = 'chevron', children }) => (
  <div
    className={`filter-clearable${active ? ' filter-clearable--active' : ''}${inset === 'plain' ? ' filter-clearable--plain' : ''}`}
  >
    {children}
    {active && (
      <button
        type="button"
        className="filter-clearable-btn"
        aria-label={`Remove ${label.toLowerCase()} filter`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onClear();
        }}
      >
        <X size={14} aria-hidden="true" />
      </button>
    )}
  </div>
);

export default FilterClearButton;
