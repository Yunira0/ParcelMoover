import React from 'react';
import MultiSearchableSelectAsync, {
  type MultiSearchableSelectAsyncResult,
} from './MultiSearchableSelectAsync';

interface MultiFilterDropdownAsyncProps {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  asyncSearch: (query: string, offset: number) => Promise<MultiSearchableSelectAsyncResult>;
  placeholder?: string;
  searchPlaceholder?: string;
  ariaLabel?: string;
  /** Extra class on the wrapping <label>, e.g. to span grid columns. */
  className?: string;
}

/** Async sibling of MultiFilterDropdown: same CAPS-label layout, but backed by
 * a server-side search instead of a fixed options array - for filters whose
 * full option set (e.g. every vendor) is too large to load upfront. */
const MultiFilterDropdownAsync: React.FC<MultiFilterDropdownAsyncProps> = ({
  label,
  value,
  onChange,
  asyncSearch,
  placeholder,
  searchPlaceholder = 'Search...',
  ariaLabel,
  className,
}) => {
  return (
    <label aria-label={ariaLabel} className={className}>
      <span>{label}</span>
      <MultiSearchableSelectAsync
        asyncSearch={asyncSearch}
        value={value}
        onChange={onChange}
        placeholder={placeholder || `Select ${label.toLowerCase()}`}
        searchPlaceholder={searchPlaceholder}
      />
    </label>
  );
};

export default MultiFilterDropdownAsync;
