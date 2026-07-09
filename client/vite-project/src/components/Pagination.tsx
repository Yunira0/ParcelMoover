import React from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
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
  /** Numbered mode - for client-side paginated lists where any page is reachable. */
  onPageChange?: (page: number) => void;
  /**
   * Cursor mode - for server keyset-paginated lists. Only sequential prev/next
   * plus first/last jumps exist (arbitrary page N has no cursor), so this
   * renders First/Prev/"Page X of Y"/Next/Last instead of numbered buttons.
   */
  cursor?: CursorPaginationControls;
  ariaLabel: string;
  summary?: React.ReactNode;
}

const ELLIPSIS = '…';

// Standard page windowing: always show the first and last page and the
// current page's neighbours, collapsing the gaps to an ellipsis. Pads near
// the edges so the control keeps a constant width (max 7 slots).
export function getPageItems(page: number, totalPages: number): Array<number | typeof ELLIPSIS> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  const current = Math.min(Math.max(page, 1), totalPages);
  const wanted = new Set<number>([1, totalPages, current - 1, current, current + 1]);
  if (current <= 3) [2, 3, 4, 5].forEach((p) => wanted.add(p));
  if (current >= totalPages - 2) [totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1].forEach((p) => wanted.add(p));

  const pages = [...wanted].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  const items: Array<number | typeof ELLIPSIS> = [];
  let previous = 0;
  for (const p of pages) {
    if (p - previous === 2) items.push(p - 1); // a 1-page gap: show the page, not "…"
    else if (p - previous > 2) items.push(ELLIPSIS);
    items.push(p);
    previous = p;
  }
  return items;
}

const Pagination: React.FC<PaginationProps> = ({ page, totalPages, onPageChange, cursor, ariaLabel, summary }) => {
  const clampedTotal = Math.max(1, totalPages);
  const clampedPage = Math.min(Math.max(page, 1), clampedTotal);

  return (
    <div className="pagination-row">
      <span className="pagination-summary">{summary}</span>
      <nav className="pagination" aria-label={ariaLabel}>
        {cursor ? (
          <>
            <button type="button" aria-label="First page" disabled={!cursor.hasPrev} onClick={cursor.onFirst}>
              <ChevronsLeft size={18} />
            </button>
            <button type="button" aria-label="Previous page" disabled={!cursor.hasPrev} onClick={cursor.onPrev}>
              <ChevronLeft size={18} />
            </button>
            <span className="pagination-status" aria-live="polite">
              Page {clampedPage} of {clampedTotal}
            </span>
            <button type="button" aria-label="Next page" disabled={!cursor.hasNext} onClick={cursor.onNext}>
              <ChevronRight size={18} />
            </button>
            <button type="button" aria-label="Last page" disabled={!cursor.hasNext} onClick={cursor.onLast}>
              <ChevronsRight size={18} />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              aria-label="Previous page"
              disabled={clampedPage === 1}
              onClick={() => onPageChange?.(Math.max(1, clampedPage - 1))}
            >
              <ChevronLeft size={18} />
            </button>
            {getPageItems(clampedPage, clampedTotal).map((item, index) =>
              item === ELLIPSIS ? (
                <span key={`ellipsis-${index}`} className="pagination-ellipsis" aria-hidden="true">
                  {ELLIPSIS}
                </span>
              ) : (
                <button
                  key={item}
                  type="button"
                  className={clampedPage === item ? 'active' : ''}
                  aria-label={`Page ${item}`}
                  aria-current={clampedPage === item ? 'page' : undefined}
                  onClick={() => onPageChange?.(item)}
                >
                  {item}
                </button>
              ),
            )}
            <button
              type="button"
              aria-label="Next page"
              disabled={clampedPage === clampedTotal}
              onClick={() => onPageChange?.(Math.min(clampedTotal, clampedPage + 1))}
            >
              <ChevronRight size={18} />
            </button>
          </>
        )}
      </nav>
    </div>
  );
};

export default Pagination;
