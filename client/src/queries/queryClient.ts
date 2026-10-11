import axios from 'axios';
import { QueryClient } from '@tanstack/react-query';
import api from '../utils/api';
import { subscribeToOrderStatusChanged } from '../services/orders.service';
import { subscribeToRemarkStatusChanged } from '../services/remarks.service';
import { subscribeToSessionEnded } from '../services/auth.service';
import { queryKeys } from './keys';

/** Reference data (locations, riders, vendors...) changes rarely. */
export const LOOKUP_STALE_MS = 10 * 60_000;

// Page data is stale immediately: a revisit paints the cached rows at once and
// refetches in the background, so several people working the same parcels
// never act on an old list. The win is no blank screen, not fewer requests.
// Refetch-on-focus stays off by default - the ops lists pull up to thousands
// of parcels and never refreshed on focus before; the dashboards opt in.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: false,
      // A 4xx (not found, forbidden, validation) won't fix itself on retry.
      retry: (failureCount, error) => {
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        if (status !== undefined && status >= 400 && status < 500) return false;
        return failureCount < 1;
      },
    },
  },
});

// Every order mutation in orders.service already announces itself; keep the
// cached lists, counts, detail views and dashboard figures in step with it.
subscribeToOrderStatusChanged(() => {
  void queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
});

// Remark open/close moves the dashboard's "today" and SLA figures.
subscribeToRemarkStatusChanged(() => {
  void queryClient.invalidateQueries({ queryKey: ['orders', 'dashboard'] });
});

// A cache built for one user must never be shown to the next one.
subscribeToSessionEnded(() => {
  queryClient.clear();
});

// Lookups are read through queryClient.fetchQuery (see lookups.ts), so they
// have no observers to refetch - invalidating only marks them stale and the
// next picker that needs them asks the server again. Any successful write
// outside the order/notification paths may have touched reference data (a new
// location, rider, vendor, branch, account...), and writes are rare next to
// reads, so this is cheaper than keeping a per-endpoint map that can drift.
const LOOKUP_NEUTRAL_WRITE = /^\/?(orders|notifications|remarks|tickets)(\/|$|\?)/;
api.interceptors.response.use((response) => {
  const method = response.config.method?.toLowerCase();
  const url = response.config.url ?? '';
  if (method && method !== 'get' && !LOOKUP_NEUTRAL_WRITE.test(url)) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.lookups.all });
  }
  return response;
});
