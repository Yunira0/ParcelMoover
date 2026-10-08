import React from 'react';
import { X } from 'lucide-react';
import Button from './Button';
import './ClearableFilter.css';

// A list filter with a clear (×) button beside it while it is set - the same
// shape as the party pickers on the settlement lists. Filters are remembered
// across visits (useSessionState), so a list can open already narrowed; the ×
// makes that visible and puts the filter back to "all" in one click.
//
// The button sits beside the control rather than inside it: the date picker's
// trigger and the select are interactive already.

interface ClearableFilterProps {
  /** Whether the filter is narrowing the list - the × shows only then. */
  active: boolean;
  onClear: () => void;
  /** Accessible name for the ×, e.g. "Clear status filter". */
  clearLabel: string;
  /** 'end' when the control carries its own caption above it (FilterDropdown),
   *  so the × lines up with the control rather than the middle of the pair. */
  align?: 'center' | 'end';
  children: React.ReactNode;
}

const ClearableFilter: React.FC<ClearableFilterProps> = ({ active, onClear, clearLabel, align = 'center', children }) => (
  <div className={align === 'end' ? 'clearable-filter clearable-filter-end' : 'clearable-filter'}>
    <div className="clearable-filter-control">{children}</div>
    {active && (
      <Button variant="outline" size="sm" onClick={onClear} aria-label={clearLabel} title={clearLabel}>
        <X size={14} />
      </Button>
    )}
  </div>
);

export default ClearableFilter;
