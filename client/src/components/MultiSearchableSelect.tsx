import React, { useEffect, useId, useRef, useState } from 'react';
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
  ariaLabel?: string;
}

const OPTION_BATCH_SIZE = 50;

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
  ariaLabel,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [visibleLimit, setVisibleLimit] = useState(OPTION_BATCH_SIZE);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

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
  const visibleOptions = filteredOptions.slice(0, visibleLimit);
  const hiddenCount = filteredOptions.length - visibleOptions.length;
  const revealNextBatch = () => setVisibleLimit(current =>
    Math.min(filteredOptions.length, current + OPTION_BATCH_SIZE),
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
        onClick={() => { setIsOpen(open => !open); setVisibleLimit(OPTION_BATCH_SIZE); }}
        disabled={disabled}
        aria-label={ariaLabel ?? placeholder}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
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
              onChange={event => { setQuery(event.target.value); setVisibleLimit(OPTION_BATCH_SIZE); }}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
            />
          </label>
          <div
            id={listboxId}
            role="listbox"
            aria-multiselectable="true"
            className="searchable-select-options searchable-select-options--multi"
            onScroll={(event) => {
              const target = event.currentTarget;
              if (hiddenCount > 0 && target.scrollHeight - target.scrollTop - target.clientHeight < 80) {
                revealNextBatch();
              }
            }}
          >
            {filteredOptions.length === 0 ? (
              <p className="searchable-select-empty">{emptyMessage}</p>
            ) : <>
              {visibleOptions.map(option => {
              const checked = selectedSet.has(option.id);
              return (
                <button
                  key={option.id}
                  type="button"
                  className={`searchable-select-option searchable-select-option--multi ${checked ? 'selected' : ''}`}
                  onClick={() => toggle(option.id)}
                  role="option"
                  aria-selected={checked}
                >
                  <span className="searchable-select-check">{checked && <Check size={14} />}</span>
                  <span>{option.label}</span>
                </button>
              );
              })}
              {hiddenCount > 0 && (
                <button type="button" className="searchable-select-more" onClick={revealNextBatch}>
                  Load next {Math.min(OPTION_BATCH_SIZE, hiddenCount)} · {hiddenCount} remaining
                </button>
              )}
            </>}
          </div>
        </div>
      )}
    </div>
  );
};

export default MultiSearchableSelect;
