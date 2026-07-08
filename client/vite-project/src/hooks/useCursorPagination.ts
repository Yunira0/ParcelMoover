import { useCallback, useMemo, useState } from 'react';
import type { CursorPaginationControls } from '../components/Pagination';

/** The subset of OrdersPageMeta (or any list meta) cursor navigation needs. */
export interface CursorMetaLike {
  totalPages: number;
  hasNextPage?: boolean;
  hasPrevPage?: boolean;
  nextCursor?: string | null;
  prevCursor?: string | null;
}

export interface CursorPaginationRequest {
  /** Display page counter, sent to the server only as an echo hint. */
  page: number;
  cursor?: string;
  dir?: 'next' | 'prev';
}

/**
 * Keyset (cursor) pagination state for server-paginated lists.
 *
 * The server never receives a row offset - navigation happens through the
 * opaque cursors it returns in the list meta. The page number is tracked
 * client-side purely for the "Page X of Y" display.
 *
 * Usage:
 *   const pager = useCursorPagination();
 *   // request: pass pager.request.cursor / pager.request.dir to the API call
 *   // reset:   pager.reset() whenever a filter/search/sort changes
 *   // render:  <Pagination cursor={pager.controls(meta)} ... />
 */
export function useCursorPagination() {
  const [request, setRequest] = useState<CursorPaginationRequest>({ page: 1 });

  const reset = useCallback(() => {
    setRequest((current) =>
      current.cursor === undefined && current.dir === undefined && current.page === 1
        ? current // keep the same reference so effects/callbacks don't re-fire
        : { page: 1 },
    );
  }, []);

  const controls = useCallback(
    (meta: CursorMetaLike | null | undefined): CursorPaginationControls => {
      const totalPages = Math.max(1, meta?.totalPages ?? 1);
      return {
        hasPrev: !!meta?.hasPrevPage,
        hasNext: !!meta?.hasNextPage,
        onFirst: () => setRequest({ page: 1 }),
        onLast: () => setRequest({ page: totalPages, dir: 'prev' }),
        onPrev: () => {
          if (!meta?.prevCursor) return;
          const prevCursor = meta.prevCursor;
          setRequest((current) => ({
            page: Math.max(1, current.page - 1),
            cursor: prevCursor,
            dir: 'prev',
          }));
        },
        onNext: () => {
          if (!meta?.nextCursor) return;
          const nextCursor = meta.nextCursor;
          setRequest((current) => ({
            page: Math.min(totalPages, current.page + 1),
            cursor: nextCursor,
            dir: 'next',
          }));
        },
      };
    },
    [],
  );

  return useMemo(
    () => ({ request, page: request.page, reset, controls }),
    [request, reset, controls],
  );
}
