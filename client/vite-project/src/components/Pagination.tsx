import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import './Pagination.css';

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  ariaLabel: string;
  summary?: React.ReactNode;
}

const Pagination: React.FC<PaginationProps> = ({ page, totalPages, onPageChange, ariaLabel, summary }) => (
  <div className="pagination-row">
    <span className="pagination-summary">{summary}</span>
    <nav className="pagination" aria-label={ariaLabel}>
      <button type="button" disabled={page === 1} onClick={() => onPageChange(Math.max(1, page - 1))}>
        <ChevronLeft size={18} />
      </button>
      {Array.from({ length: Math.min(totalPages, 3) }, (_, index) => index + 1).map((pageNumber) => (
        <button
          key={pageNumber}
          type="button"
          className={page === pageNumber ? 'active' : ''}
          onClick={() => onPageChange(pageNumber)}
        >
          {pageNumber}
        </button>
      ))}
      <button type="button" disabled={page === totalPages} onClick={() => onPageChange(Math.min(totalPages, page + 1))}>
        <ChevronRight size={18} />
      </button>
    </nav>
  </div>
);

export default Pagination;
