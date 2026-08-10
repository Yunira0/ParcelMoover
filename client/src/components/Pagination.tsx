import React from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import './Pagination.css';

/** Navigation callbacks for keyset (cursor) paginated lists. */
export interface CursorPaginationControls {
  hasPrev: boolean;
  hasNext: boolean;
  onFirst: () => void;
  onPrev: () => void;
  onNext: () => void;
  onLast: () => void;
}

interface PaginationProps {
  page: number;
  totalPages: number;
  /**
   * Offset mode - for lists where any page is directly reachable (client-side
   * slices and skip/take endpoints). Drives the same First/Prev/Next/Last
   * stepper as cursor mode; the jumps are just computed from the page number.
   */
  onPageChange?: (page: number) => void;
  /**
   * Cursor mode - for server keyset-paginated lists. Only sequential prev/next
   * plus first/last jumps exist (arbitrary page N has no cursor), so these
   * callbacks carry the server's cursors instead of a page number.
   */
  cursor?: CursorPaginationControls;
  ariaLabel: string;
  summary?: React.ReactNode;
  /** Current rows-per-page. When set alongside onPageSizeChange, renders a selector at the end of the row. */
  pageSize?: number;
  /** Called when the user picks a different rows-per-page value. */
  onPageSizeChange?: (size: number) => void;
  /** Options offered in the rows-per-page selector. Defaults to 10/20/50/100. */
  pageSizeOptions?: number[];
  /** Noun shown next to the selector, e.g. "parcels". Defaults to "rows". */
  pageSizeLabel?: string;
}

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

const Pagination: React.FC<PaginationProps> = ({
  page,
  totalPages,
  onPageChange,
  cursor,
  ariaLabel,
  summary,
  pageSize,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  pageSizeLabel = 'rows',
}) => {
  const clampedTotal = Math.max(1, totalPages);
  const clampedPage = Math.min(Math.max(page, 1), clampedTotal);
  const showPageSize = pageSize !== undefined && !!onPageSizeChange;

  // One control for both modes: cursor lists supply their own navigation
  // (arbitrary page N has no cursor), offset lists get the equivalent derived
  // from the page number.
  const nav: CursorPaginationControls = cursor ?? {
    hasPrev: clampedPage > 1,
    hasNext: clampedPage < clampedTotal,
    onFirst: () => onPageChange?.(1),
    onPrev: () => onPageChange?.(Math.max(1, clampedPage - 1)),
    onNext: () => onPageChange?.(Math.min(clampedTotal, clampedPage + 1)),
    onLast: () => onPageChange?.(clampedTotal),
  };

  return (
    <div className="pagination-row">
      <span className="pagination-summary">{summary}</span>
      <nav className="pagination" aria-label={ariaLabel}>
        <button type="button" aria-label="First page" disabled={!nav.hasPrev} onClick={nav.onFirst}>
          <ChevronsLeft size={18} />
        </button>
        <button type="button" aria-label="Previous page" disabled={!nav.hasPrev} onClick={nav.onPrev}>
          <ChevronLeft size={18} />
        </button>
        <span className="pagination-status" aria-live="polite">
          Page {clampedPage} of {clampedTotal}
        </span>
        <button type="button" aria-label="Next page" disabled={!nav.hasNext} onClick={nav.onNext}>
          <ChevronRight size={18} />
        </button>
        <button type="button" aria-label="Last page" disabled={!nav.hasNext} onClick={nav.onLast}>
          <ChevronsRight size={18} />
        </button>
      </nav>
      {showPageSize && (
        <label className="pagination-size">
          <span className="pagination-size-text">{pageSizeLabel} per page</span>
          <span className="pagination-size-select">
            <select
              aria-label={`${pageSizeLabel} per page`}
              value={pageSize}
              onChange={(event) => onPageSizeChange?.(Number(event.target.value))}
            >
              {(pageSizeOptions.includes(pageSize!)
                ? pageSizeOptions
                : [...pageSizeOptions, pageSize!].sort((a, b) => a - b)
              ).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <ChevronDown size={16} aria-hidden="true" />
          </span>
        </label>
      )}
    </div>
  );
};

export default Pagination;
