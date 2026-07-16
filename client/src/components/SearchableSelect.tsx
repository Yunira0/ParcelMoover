import React, { useEffect, useRef, useState } from 'react';
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
}

const SearchableSelect: React.FC<SearchableSelectProps> = ({
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
  // Keyboard-highlighted row in the filtered list (arrow keys + Enter).
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);

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

  // Typing a new query re-anchors the highlight to the first match.
  useEffect(() => {
    setActiveIndex(0);
  }, [query, isOpen]);

  // Keep the keyboard-highlighted row visible while arrowing through the list.
  useEffect(() => {
    optionsRef.current
      ?.querySelector('.searchable-select-option.active')
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex(i => Math.min(i + 1, filteredOptions.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(i => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      // Selects the highlighted option instead of submitting the parent form.
      event.preventDefault();
      const option = filteredOptions[activeIndex];
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
        onClick={() => setIsOpen(open => !open)}
        disabled={disabled}
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
              onChange={event => setQuery(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder={searchPlaceholder}
            />
          </label>
          <div className="searchable-select-options" ref={optionsRef}>
            {filteredOptions.length === 0 ? (
              <p className="searchable-select-empty">{emptyMessage}</p>
            ) : filteredOptions.map((option, index) => (
              <button
                key={option.id}
                type="button"
                className={`searchable-select-option ${option.id === value ? 'selected' : ''} ${index === activeIndex ? 'active' : ''}`}
                onClick={() => handleSelect(option.id)}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <span>{highlight(option.label)}</span>
                {option.description && <small>{highlight(option.description)}</small>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default SearchableSelect;
