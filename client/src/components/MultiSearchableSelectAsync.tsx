import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Loader2, Search } from 'lucide-react';
import './SearchableSelect.css';

export interface MultiSearchableSelectAsyncOption {
  id: string;
  label: string;
}

export interface MultiSearchableSelectAsyncResult {
  results: MultiSearchableSelectAsyncOption[];
  hasMore: boolean;
}

interface MultiSearchableSelectAsyncProps {
  /** Called on every keystroke (debounced) to fetch options from the server. */
  asyncSearch: (query: string, offset: number) => Promise<MultiSearchableSelectAsyncResult>;
  /** Currently selected option ids. */
  value: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  /** Minimum characters before the first server call. Default: 0 (load on open). */
  minChars?: number;
  /** Debounce delay in ms. Default: 300. */
  debounceMs?: number;
}

/** Async, paginated sibling of MultiSearchableSelect - for pickers backed by
 * lists too large to load upfront (e.g. hundreds of vendors). Panel stays
 * open while toggling, matching MultiSearchableSelect's UX; loading/paging/
 * debounce infra matches SearchableSelectAsync. */
const MultiSearchableSelectAsync: React.FC<MultiSearchableSelectAsyncProps> = ({
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
  const [options, setOptions] = useState<MultiSearchableSelectAsyncOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  // Remembers every id->label pair ever seen, so the trigger can still show a
  // selected vendor's name after a new search/page replaces `options` and it's
  // no longer in the loaded list.
  const [labelCache, setLabelCache] = useState<Map<string, string>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef(0);
  const offsetRef = useRef(0);

  const selectedSet = new Set(value);

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
            setLabelCache(prev => {
              let changed = false;
              const next = new Map(prev);
              for (const opt of res.results) {
                if (next.get(opt.id) !== opt.label) {
                  next.set(opt.id, opt.label);
                  changed = true;
                }
              }
              return changed ? next : prev;
            });
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

  const toggle = (id: string) => {
    if (selectedSet.has(id)) onChange(value.filter(v => v !== id));
    else onChange([...value, id]);
  };

  const handleScroll = useCallback(() => {
    const el = optionsRef.current;
    if (!el || loading || loadingMore || !hasMore) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    if (nearBottom) {
      fetchOptions(query, offsetRef.current, true);
    }
  }, [query, loading, loadingMore, hasMore, fetchOptions]);

  // Trigger label lists every selected option (comma-separated), sourced from
  // labelCache so it stays correct regardless of what's currently loaded.
  const triggerLabel = value.length
    ? value.map(id => labelCache.get(id) || id).join(', ')
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
          className={`searchable-select-value${value.length ? '' : ' searchable-select-placeholder'}`}
          title={value.length ? triggerLabel : undefined}
        >
          {triggerLabel}
        </span>
        <ChevronDown size={16} className="searchable-select-icon" />
      </button>

      {isOpen && (
        <div className="searchable-select-panel searchable-select-panel--multi">
          <div className="searchable-select-search">
            <Search size={14} />
            <input
              autoFocus
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
            />
            {loading && <Loader2 size={14} className="searchable-select-spinner" />}
          </div>
          <div
            className="searchable-select-options searchable-select-options--multi"
            ref={optionsRef}
            onScroll={handleScroll}
          >
            {options.length === 0 && !loading ? (
              <p className="searchable-select-empty">{emptyMessage}</p>
            ) : options.map((option) => {
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

export default MultiSearchableSelectAsync;
