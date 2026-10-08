// Every query key the dashboard caches under, in one place. Keys are
// hierarchical so a whole family can be invalidated at once: anything that
// changes a parcel invalidates `queryKeys.orders.all`, which covers the lists,
// counts and detail views built from it.
export const queryKeys = {
  orders: {
    all: ['orders'] as const,
    list: (params: unknown) => ['orders', 'list', params] as const,
    countsByStatus: (params: unknown) => ['orders', 'counts-by-status', params] as const,
    statusCounts: (groups: unknown, filters: unknown) => ['orders', 'status-counts', groups, filters] as const,
    detail: (trackingId: string) => ['orders', 'detail', trackingId] as const,
    recent: (limit: number) => ['orders', 'recent', limit] as const,
  },
  // Filter dropdown options are a heavy, slow-moving read: deliberately outside
  // `orders` so a status change doesn't refetch them.
  orderFilterOptions: (status: unknown) => ['order-filter-options', status] as const,
  // Dashboard widgets read order data too, so they live under `orders` and
  // refresh with it.
  dashboard: {
    summary: (trendDays: number) => ['orders', 'dashboard', 'summary', trendDays] as const,
    vendorSummary: (params: unknown) => ['orders', 'dashboard', 'vendor-summary', params] as const,
    topVendors: ['orders', 'dashboard', 'top-vendors'] as const,
  },
  // Reference data for dropdowns and pickers. Cached much longer than order
  // data and invalidated by any write outside /orders (see queryClient.ts).
  lookups: {
    all: ['lookups'] as const,
    locations: ['lookups', 'locations'] as const,
    branches: ['lookups', 'branches'] as const,
    vendorSearch: (search: string, limit: number, offset: number) =>
      ['lookups', 'vendor-search', search, limit, offset] as const,
    allAdmins: (params: unknown) => ['lookups', 'all-admins', params] as const,
    allRiders: (params: unknown) => ['lookups', 'all-riders', params] as const,
    accounts: (scope: string | undefined) => ['lookups', 'accounts', scope ?? 'all'] as const,
    periods: ['lookups', 'accounting-periods'] as const,
  },
};
