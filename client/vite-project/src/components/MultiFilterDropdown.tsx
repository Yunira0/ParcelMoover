import React from 'react';
import MultiSearchableSelect from './MultiSearchableSelect';
import type { SearchableSelectOption } from './SearchableSelect';
import type { FilterDropdownOption } from './FilterDropdown';

interface MultiFilterDropdownProps {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  options: FilterDropdownOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  ariaLabel?: string;
  /** Extra class on the wrapping <label>, e.g. to span grid columns. */
  className?: string;
}

/** Multi-select sibling of FilterDropdown: same CAPS-label layout, but holds
 * several selected values at once for filters that should OR their options. */
const MultiFilterDropdown: React.FC<MultiFilterDropdownProps> = ({
  label,
  value,
  onChange,
  options,
  placeholder,
  searchPlaceholder = 'Search...',
  ariaLabel,
  className,
}) => {
  const searchableOptions: SearchableSelectOption[] = options.map((opt) => ({ id: opt.value, label: opt.label }));

  return (
    <label aria-label={ariaLabel} className={className}>
      <span>{label}</span>
      <MultiSearchableSelect
        options={searchableOptions}
        value={value}
        onChange={onChange}
        placeholder={placeholder || `Select ${label.toLowerCase()}`}
        searchPlaceholder={searchPlaceholder}
      />
    </label>
  );
};

export default MultiFilterDropdown;
