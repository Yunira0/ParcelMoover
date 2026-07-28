import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Loader2, Search } from 'lucide-react';
import './SearchableSelect.css';

export interface SearchableSelectAsyncOption {
  id: string;
  label: string;
  description?: string;
}

export interface SearchableSelectAsyncResult {
  results: SearchableSelectAsyncOption[];
  hasMore: boolean;
}

interface SearchableSelectAsyncProps {
  /** Called on every keystroke (debounced) to fetch options from the server. */
  asyncSearch: (query: string, offset: number) => Promise<SearchableSelectAsyncResult>;
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  /** Minimum characters before the first server call. Default: 0 (load on open). */
  minChars?: number;
  /** Debounce delay in ms. Default: 300. */
  debounceMs?: number;
}

const SearchableSelectAsync: React.FC<SearchableSelectAsyncProps> = ({
  asyncSearch,
  value,
  onChange,
  placeholder = 'Select...',
  searchPlaceholder = 'Search...',
  emptyMessage = 'No matches found.',
  disabled = false,
  minChars = 0,
  debounceMs = 300,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<SearchableSelectAsyncOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef(0);
  const offsetRef = useRef(0);

  const selectedOption = options.find(o => o.id === value);

  const fetchOptions = useCallback(
    (search: string, offset: number, append: boolean) => {
      if (search.length < minChars) {
        setOptions([]);
        setHasMore(false);
        return;
      }
      const callId = ++abortRef.current;
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      asyncSearch(search, offset)
        .then((res) => {
          if (callId === abortRef.current) {
            setOptions(prev => append ? [...prev, ...res.results] : res.results);
            setHasMore(res.hasMore);
            setLoading(false);
            setLoadingMore(false);
            offsetRef.current = offset + res.results.length;
          }
        })
        .catch(() => {
          if (callId === abortRef.current) {
            if (!append) setOptions([]);
            setHasMore(false);
            setLoading(false);
            setLoadingMore(false);
          }
        });
    },
    [asyncSearch, minChars],
  );

  const prevQueryRef = useRef(query);

  // Reset activeIndex when query changes (not inside the fetch effect to avoid setState-in-effect).
  useEffect(() => {
    if (prevQueryRef.current !== query) {
      setActiveIndex(0);
      prevQueryRef.current = query;
    }
  }, [query]);

  // Debounced search: fires on query change and on dropdown open (empty query).
  useEffect(() => {
    if (!isOpen) return;
    offsetRef.current = 0;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchOptions(query, 0, false), debounceMs);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, isOpen, fetchOptions, debounceMs]);

  // Close on outside click.
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

  const highlight = (text: string | undefined): React.ReactNode => {
    if (!text) return '';
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

  useEffect(() => {
    optionsRef.current
      ?.querySelector('.searchable-select-option.active')
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, options, loading]);

  const handleScroll = useCallback(() => {
    const el = optionsRef.current;
    if (!el || loading || loadingMore || !hasMore) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    if (nearBottom) {
      fetchOptions(query, offsetRef.current, true);
    }
  }, [query, loading, loadingMore, hasMore, fetchOptions]);

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex(i => Math.min(i + 1, options.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(i => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = options[activeIndex];
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
          <div className="searchable-select-search">
            <Search size={14} />
            <input
              autoFocus
              value={query}
              onChange={event => setQuery(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder={searchPlaceholder}
            />
            {loading && <Loader2 size={14} className="searchable-select-spinner" />}
          </div>
          <div
            className="searchable-select-options"
            ref={optionsRef}
            onScroll={handleScroll}
          >
            {options.length === 0 && !loading ? (
              <p className="searchable-select-empty">{emptyMessage}</p>
            ) : options.map((option, index) => (
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
            {loadingMore && (
              <div className="searchable-select-loading-more">
                <Loader2 size={14} className="searchable-select-spinner" />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SearchableSelectAsync;
