import type { Query } from '@tanstack/react-query';
import {
  getAllAdmins as fetchAllAdmins,
  getAllRiders as fetchAllRiders,
  getLocations as fetchLocations,
  searchVendors as fetchVendorSearch,
} from '../services/users.service';
import { listBranches as fetchBranches } from '../services/branchTracking.service';
import { listAccounts as fetchAccounts, listPeriods as fetchPeriods } from '../services/accounting.service';
import { queryClient, LOOKUP_STALE_MS } from './queryClient';
import { queryKeys } from './keys';

// Cached drop-in replacements for the reference-data reads behind pickers and
// dropdowns. Same names, arguments and return values as the service functions,
// so a call site only swaps its import. The first caller hits the server;
// everyone after it (on any page) gets the cached copy until a write outside
// /orders invalidates it or LOOKUP_STALE_MS passes. Treat results as
// read-only - they are shared between callers.

// An envelope that came back `success: false` is served once but never kept,
// so a transient failure doesn't pin an empty dropdown for ten minutes.
const lookupStaleTime = <T>(query: Query<T, Error, T, readonly unknown[]>) => {
  const data = query.state.data as { success?: boolean } | undefined;
  return data && typeof data === 'object' && data.success === false ? 0 : LOOKUP_STALE_MS;
};

const cached = <T>(queryKey: readonly unknown[], queryFn: () => Promise<T>): Promise<T> =>
  queryClient.fetchQuery<T, Error, T, readonly unknown[]>({ queryKey, queryFn, staleTime: lookupStaleTime });

export const getLocations = (): ReturnType<typeof fetchLocations> =>
  cached(queryKeys.lookups.locations, fetchLocations);

export const searchVendors = (search: string, limit = 50, offset = 0): ReturnType<typeof fetchVendorSearch> =>
  cached(queryKeys.lookups.vendorSearch(search, limit, offset), () => fetchVendorSearch(search, limit, offset));

export const getAllAdmins = (params?: Parameters<typeof fetchAllAdmins>[0]): ReturnType<typeof fetchAllAdmins> =>
  cached(queryKeys.lookups.allAdmins(params ?? {}), () => fetchAllAdmins(params));

export const getAllRiders = (params?: Parameters<typeof fetchAllRiders>[0]): ReturnType<typeof fetchAllRiders> =>
  cached(queryKeys.lookups.allRiders(params ?? {}), () => fetchAllRiders(params));

export const listBranches = (): ReturnType<typeof fetchBranches> =>
  cached(queryKeys.lookups.branches, () => fetchBranches());

export const listAccounts = (scope?: 'cash_bank'): ReturnType<typeof fetchAccounts> =>
  cached(queryKeys.lookups.accounts(scope), () => fetchAccounts(scope));

export const listPeriods = (): ReturnType<typeof fetchPeriods> =>
  cached(queryKeys.lookups.periods, fetchPeriods);
