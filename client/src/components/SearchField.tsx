import React from 'react';
import { Search, X } from 'lucide-react';
import './SearchField.css';

interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
  /** Sets the control's width. Defaults to filling its container. */
  width?: string;
}

/** The bordered search input every list screen uses: magnifier, borderless
 *  input, primary focus ring on the box rather than the field inside it. */
const SearchField: React.FC<SearchFieldProps> = ({
  value,
  onChange,
  placeholder = 'Search',
  ariaLabel,
  autoFocus,
  width,
}) => (
  <div className="search-field" style={width ? { width } : undefined}>
    <Search size={16} aria-hidden="true" />
    <input
      type="text"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel ?? placeholder}
      autoFocus={autoFocus}
    />
    {value && (
      <button type="button" onClick={() => onChange('')} aria-label="Clear search">
        <X size={14} />
      </button>
    )}
  </div>
);

export default SearchField;
