import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getDashboardSummary } from '../services/orders.service';
import { queryKeys } from './keys';

const REFRESH_INTERVAL_MS = 15_000;

/**
 * The /orders/dashboard-summary read behind the admin, vendor and sales
 * dashboards (the server scopes it to the caller). Polled while the tab is
 * visible, refetched on focus, and invalidated whenever an order or remark
 * changes (queryClient.ts). Switching the trend period keeps the previous
 * summary on screen - `isPlaceholderData` is true until the new one lands.
 */
export const useDashboardSummary = (trendDays: 7 | 30 = 7) =>
  useQuery({
    queryKey: queryKeys.dashboard.summary(trendDays),
    queryFn: () => getDashboardSummary(trendDays),
    placeholderData: keepPreviousData,
    refetchInterval: REFRESH_INTERVAL_MS,
    refetchOnWindowFocus: true,
  });
