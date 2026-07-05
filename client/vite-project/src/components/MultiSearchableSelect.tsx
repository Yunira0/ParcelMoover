import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import type { SearchableSelectOption } from './SearchableSelect';
import './SearchableSelect.css';

interface MultiSearchableSelectProps {
  options: SearchableSelectOption[];
  /** Currently selected option ids. */
  value: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
}

/** Multi-select counterpart to SearchableSelect: the panel stays open while you
 * toggle options, and the trigger summarises how many are picked. Shares the
 * SearchableSelect styles so it drops into the same filter panels. */
const MultiSearchableSelect: React.FC<MultiSearchableSelectProps> = ({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  searchPlaceholder = 'Search...',
  emptyMessage = 'No matches found.',
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedSet = new Set(value);
  const selectedOptions = options.filter(option => selectedSet.has(option.id));

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredOptions = options.filter(option =>
    option.label.toLowerCase().includes(query.trim().toLowerCase()),
  );

  const toggle = (id: string) => {
    if (selectedSet.has(id)) onChange(value.filter(v => v !== id));
    else onChange([...value, id]);
  };

  // Trigger label lists every selected option (comma-separated); the trigger
  // ellipsis-truncates it when it overflows the field.
  const triggerLabel = selectedOptions.length
    ? selectedOptions.map(option => option.label).join(', ')
    : placeholder;

  return (
    <div className="searchable-select" ref={containerRef}>
      <button
        type="button"
        className="searchable-select-trigger"
        onClick={() => setIsOpen(open => !open)}
        disabled={disabled}
      >
        <span
          className={`searchable-select-value${selectedOptions.length ? '' : ' searchable-select-placeholder'}`}
          title={selectedOptions.length ? triggerLabel : undefined}
        >
          {triggerLabel}
        </span>
        <ChevronDown size={16} className="searchable-select-icon" />
      </button>

      {isOpen && (
        <div className="searchable-select-panel searchable-select-panel--multi">
          <label className="searchable-select-search">
            <Search size={14} />
            <input
              autoFocus
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
            />
          </label>
          <div className="searchable-select-options searchable-select-options--multi">
            {filteredOptions.length === 0 ? (
              <p className="searchable-select-empty">{emptyMessage}</p>
            ) : filteredOptions.map(option => {
              const checked = selectedSet.has(option.id);
              return (
                <button
                  key={option.id}
                  type="button"
                  className={`searchable-select-option searchable-select-option--multi ${checked ? 'selected' : ''}`}
                  onClick={() => toggle(option.id)}
                  aria-pressed={checked}
                >
                  <span className="searchable-select-check">{checked && <Check size={14} />}</span>
                  <span>{option.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default MultiSearchableSelect;
