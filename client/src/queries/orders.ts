import type React from 'react';
import { getOrderByTrackingId } from '../services/orders.service';
import { queryClient } from './queryClient';
import { queryKeys } from './keys';

/**
 * The order detail read, shared by OrderDetailPage and the hover prefetch so
 * both fill the same cache entry. A copy younger than a few seconds is used
 * as-is - that is what makes a hover-then-click open instantly without a
 * second request; anything older is shown while it refetches. Changes made in
 * this tab invalidate it immediately (queryClient.ts).
 */
export const orderDetailQuery = (trackingId: string) => ({
  queryKey: queryKeys.orders.detail(trackingId),
  queryFn: () => getOrderByTrackingId(trackingId),
  staleTime: 5_000,
});

const ORDER_LINK_PATH = /^\/orders\/track\/([^/?#]+)/;
// Long enough that sweeping the pointer down a table doesn't fetch every row
// it crosses, short enough to stay well ahead of a deliberate click.
const HOVER_INTENT_MS = 120;
let detailChunkRequested = false;
let hoverTimer: ReturnType<typeof setTimeout> | undefined;
let hoverHref: string | null = null;

const prefetchOrder = (trackingId: string) => {
  if (!detailChunkRequested) {
    detailChunkRequested = true;
    void import('../pages/OrderDetailPage');
  }
  void queryClient.prefetchQuery(orderDetailQuery(trackingId));
};

const trackingIdFromHref = (href: string | null): string | null => {
  const match = ORDER_LINK_PATH.exec(href ?? '');
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
};

/**
 * Delegated hover/focus handler for the signed-in shell: resting the pointer
 * on (or tabbing to) any link to an order's detail page starts loading that
 * page's code and data, so the ~300 ms round trip mostly overlaps the user's
 * own click. Covers every `/orders/track/:id` link without touching each one.
 */
export const prefetchOrderFromLink = (event: React.SyntheticEvent) => {
  const href = (event.target as Element | null)?.closest?.('a[href]')?.getAttribute('href') ?? null;
  const trackingId = trackingIdFromHref(href);

  if (event.type === 'focus') {
    if (trackingId) prefetchOrder(trackingId);
    return;
  }
  // mouseover bubbles from every child of the link; only a new target counts.
  if (href === hoverHref) return;
  clearTimeout(hoverTimer);
  hoverHref = trackingId ? href : null;
  if (trackingId) hoverTimer = setTimeout(() => prefetchOrder(trackingId), HOVER_INTENT_MS);
};
