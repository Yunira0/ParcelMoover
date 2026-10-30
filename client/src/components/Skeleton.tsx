import type { CSSProperties, ReactNode } from 'react';
import './Skeleton.css';

type Size = number | string;

interface SkeletonProps {
  width?: Size;
  height?: Size;
  circle?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function Skeleton({ width, height, circle, className = '', style }: SkeletonProps) {
  return (
    <span
      className={['skeleton', circle ? 'skeleton-circle' : '', className].filter(Boolean).join(' ')}
      style={{ width, height, ...style }}
      aria-hidden="true"
    />
  );
}

// Announces the busy state to screen readers without any visible text.
export function SkeletonRegion({ children, className = '', label = 'Loading' }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <div className={['skeleton-region', className].filter(Boolean).join(' ')} role="status" aria-busy="true" aria-label={label}>
      {children}
    </div>
  );
}

const LINE_WIDTHS = ['92%', '78%', '85%', '64%', '88%', '70%'];

export function SkeletonText({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={['skeleton-text', className].filter(Boolean).join(' ')} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} width={i === lines - 1 && lines > 1 ? '55%' : LINE_WIDTHS[i % LINE_WIDTHS.length]} />
      ))}
    </div>
  );
}

export function SkeletonCard({ lines = 3, title = true, className = '' }: { lines?: number; title?: boolean; className?: string }) {
  return (
    <div className={['skeleton-card', className].filter(Boolean).join(' ')} aria-hidden="true">
      {title && <Skeleton width="40%" height={16} />}
      <SkeletonText lines={lines} />
    </div>
  );
}

// For hand-built <tbody>s; Table.tsx renders its own.
export function SkeletonRows({ rows = 6, columns }: { rows?: number; columns: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="skeleton-row" aria-hidden="true">
          {Array.from({ length: columns }).map((_, c) => (
            <td key={c}><Skeleton width={c === 0 ? '60%' : '75%'} /></td>
          ))}
        </tr>
      ))}
    </>
  );
}

// Standalone stack of row bars for list-shaped content outside a <table>.
export function SkeletonList({ rows = 5, className = '' }: { rows?: number; className?: string }) {
  return (
    <SkeletonRegion className={['skeleton-list', className].filter(Boolean).join(' ')}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton-list-row">
          <Skeleton width="28%" />
          <Skeleton width="18%" />
          <Skeleton width="22%" />
          <Skeleton width="12%" />
        </div>
      ))}
    </SkeletonRegion>
  );
}

export function SkeletonForm({ fields = 4, className = '' }: { fields?: number; className?: string }) {
  return (
    <SkeletonRegion className={['skeleton-form', className].filter(Boolean).join(' ')}>
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className="skeleton-field">
          <Skeleton width={i % 2 ? 96 : 128} height={12} />
          <Skeleton width="100%" height={36} />
        </div>
      ))}
    </SkeletonRegion>
  );
}

// Page-level placeholder: an optional heading block followed by cards.
export function SkeletonPage({ cards = 2, heading = true, className = '' }: { cards?: number; heading?: boolean; className?: string }) {
  return (
    <SkeletonRegion className={['skeleton-page', className].filter(Boolean).join(' ')}>
      {heading && (
        <div className="skeleton-page-head">
          <Skeleton width={220} height={22} />
          <Skeleton width={320} height={14} />
        </div>
      )}
      {Array.from({ length: cards }).map((_, i) => (
        <SkeletonCard key={i} lines={i === 0 ? 4 : 3} />
      ))}
    </SkeletonRegion>
  );
}
