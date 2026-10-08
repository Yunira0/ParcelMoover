import React, { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import './SearchableSelect.css';

export interface SearchableSelectOption {
  id: string;
  label: string;
  description?: string;
}

interface SearchableSelectProps {
  options: SearchableSelectOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  ariaLabel?: string;
}

// Large branch/location lists are progressively rendered. Every matching
// option remains reachable by scrolling, while the DOM only grows one small
// batch at a time instead of mounting thousands of buttons at once.
const OPTION_BATCH_SIZE = 50;

const SearchableSelect: React.FC<SearchableSelectProps> = ({
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
  // Keyboard-highlighted row in the filtered list (arrow keys + Enter).
  const [activeIndex, setActiveIndex] = useState(0);
  const [visibleLimit, setVisibleLimit] = useState(OPTION_BATCH_SIZE);
  const containerRef = useRef<HTMLDivElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const selectedOption = options.find(option => option.id === value);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const normalizedQuery = query.trim().toLowerCase();

  // Descriptions are searched too, so an option is findable by its secondary
  // text (a branch by one of its covered areas, a rider by phone/location).
  const filteredOptions = options.filter(option =>
    option.label.toLowerCase().includes(normalizedQuery) ||
    (option.description?.toLowerCase().includes(normalizedQuery) ?? false),
  );
  const visibleOptions = filteredOptions.slice(0, visibleLimit);
  const hiddenCount = filteredOptions.length - visibleOptions.length;

  const revealNextBatch = () => {
    setVisibleLimit(current => Math.min(filteredOptions.length, current + OPTION_BATCH_SIZE));
  };

  // Wraps every case-insensitive occurrence of the query in <mark> so the user
  // sees why an option matched (e.g. the covered area they typed).
  const highlight = (text: string): React.ReactNode => {
    if (!normalizedQuery) return text;
    const lower = text.toLowerCase();
    const parts: React.ReactNode[] = [];
    let start = 0;
    let idx = lower.indexOf(normalizedQuery);
    while (idx !== -1) {
      if (idx > start) parts.push(text.slice(start, idx));
      parts.push(<mark key={idx}>{text.slice(idx, idx + normalizedQuery.length)}</mark>);
      start = idx + normalizedQuery.length;
      idx = lower.indexOf(normalizedQuery, start);
    }
    if (parts.length === 0) return text;
    parts.push(text.slice(start));
    return parts;
  };

  const handleSelect = (id: string) => {
    onChange(id);
    setIsOpen(false);
    setQuery('');
  };

  // Keep the keyboard-highlighted row visible while arrowing through the list.
  useEffect(() => {
    optionsRef.current
      ?.querySelector('.searchable-select-option.active')
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex(i => {
        if (i >= visibleOptions.length - 1 && hiddenCount > 0) {
          revealNextBatch();
          return i + 1;
        }
        return Math.min(i + 1, visibleOptions.length - 1);
      });
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(i => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      // Selects the highlighted option instead of submitting the parent form.
      event.preventDefault();
      const option = visibleOptions[activeIndex];
      if (option) handleSelect(option.id);
    } else if (event.key === 'Escape') {
      setIsOpen(false);
      setQuery('');
    }
  };

  return (
    <div className="searchable-select" ref={containerRef}>
      <button
        type="button"
        className="searchable-select-trigger"
        onClick={() => {
          setIsOpen(open => !open);
          setActiveIndex(0);
          setVisibleLimit(OPTION_BATCH_SIZE);
        }}
        disabled={disabled}
        aria-label={ariaLabel ?? placeholder}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
      >
        <span className={`searchable-select-value${selectedOption ? '' : ' searchable-select-placeholder'}`}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown size={16} className="searchable-select-icon" />
      </button>

      {isOpen && (
        <div className="searchable-select-panel">
          <label className="searchable-select-search">
            <Search size={14} />
            <input
              autoFocus
              value={query}
              onChange={event => {
                setQuery(event.target.value);
                setActiveIndex(0);
                setVisibleLimit(OPTION_BATCH_SIZE);
              }}
              onKeyDown={handleSearchKeyDown}
              placeholder={searchPlaceholder}
              role="combobox"
              aria-label={searchPlaceholder}
              aria-expanded="true"
              aria-controls={listboxId}
              aria-activedescendant={visibleOptions[activeIndex] ? `${listboxId}-${visibleOptions[activeIndex].id}` : undefined}
            />
          </label>
          <div
            className="searchable-select-options"
            ref={optionsRef}
            id={listboxId}
            role="listbox"
            onScroll={(event) => {
              const target = event.currentTarget;
              if (hiddenCount > 0 && target.scrollHeight - target.scrollTop - target.clientHeight < 80) {
                revealNextBatch();
              }
            }}
          >
            {filteredOptions.length === 0 ? (
              <p className="searchable-select-empty">{emptyMessage}</p>
            ) : (
              <>
                {visibleOptions.map((option, index) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`searchable-select-option ${option.id === value ? 'selected' : ''} ${index === activeIndex ? 'active' : ''}`}
                    onClick={() => handleSelect(option.id)}
                    onMouseEnter={() => setActiveIndex(index)}
                    id={`${listboxId}-${option.id}`}
                    role="option"
                    aria-selected={option.id === value}
                  >
                    <span>{highlight(option.label)}</span>
                    {option.description && <small>{highlight(option.description)}</small>}
                  </button>
                ))}
                {hiddenCount > 0 && (
                  <button type="button" className="searchable-select-more" onClick={revealNextBatch}>
                    Load next {Math.min(OPTION_BATCH_SIZE, hiddenCount)} · {hiddenCount} remaining
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SearchableSelect;
