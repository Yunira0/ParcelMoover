import React from 'react';
import SearchableSelect, { type SearchableSelectOption } from './SearchableSelect';

export interface FilterDropdownOption {
  value: string;
  label: string;
}

interface FilterDropdownProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: FilterDropdownOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  ariaLabel?: string;
}

/** A labeled, in-dropdown-searchable filter control — the searchable counterpart
 * to a plain `<select>` in a filter panel. Wraps SearchableSelect with the same
 * CAPS-label layout every filter panel already uses. */
const FilterDropdown: React.FC<FilterDropdownProps> = ({
  label,
  value,
  onChange,
  options,
  placeholder,
  searchPlaceholder = 'Search...',
  ariaLabel,
}) => {
  const searchableOptions: SearchableSelectOption[] = options.map((opt) => ({ id: opt.value, label: opt.label }));

  return (
    <label aria-label={ariaLabel}>
      <span>{label}</span>
      <SearchableSelect
        options={searchableOptions}
        value={value}
        onChange={onChange}
        placeholder={placeholder || `Select ${label.toLowerCase()}`}
        searchPlaceholder={searchPlaceholder}
      />
    </label>
  );
};

export default FilterDropdown;
