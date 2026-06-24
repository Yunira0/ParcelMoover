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
  const containerRef = useRef<HTMLDivElement>(null);

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

  const filteredOptions = options.filter(option =>
    option.label.toLowerCase().includes(query.trim().toLowerCase()),
  );

  const handleSelect = (id: string) => {
    onChange(id);
    setIsOpen(false);
    setQuery('');
  };

  return (
    <div className="searchable-select" ref={containerRef}>
      <button
        type="button"
        className="searchable-select-trigger"
        onClick={() => setIsOpen(open => !open)}
        disabled={disabled}
      >
        <span className={selectedOption ? '' : 'searchable-select-placeholder'}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown size={14} />
      </button>

      {isOpen && (
        <div className="searchable-select-panel">
          <label className="searchable-select-search">
            <Search size={14} />
            <input
              autoFocus
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
            />
          </label>
          <div className="searchable-select-options">
            {filteredOptions.length === 0 ? (
              <p className="searchable-select-empty">{emptyMessage}</p>
            ) : filteredOptions.map(option => (
              <button
                key={option.id}
                type="button"
                className={`searchable-select-option ${option.id === value ? 'selected' : ''}`}
                onClick={() => handleSelect(option.id)}
              >
                <span>{option.label}</span>
                {option.description && <small>{option.description}</small>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default SearchableSelect;
