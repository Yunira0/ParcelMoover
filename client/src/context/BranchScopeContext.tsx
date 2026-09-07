import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useBranchAccess } from '../hooks/useBranchAccess';
import { listBranches, type Branch } from '../services/branchTracking.service';
import { getCurrentUserLocationId } from '../utils/auth';

/**
 * App-wide branch scope for Branch Tracking. On statement screens,
 * `fromBranchId` is the paying branch and `toBranchId` is the receiving master
 * branch. Order reports still use them as origin/destination filters.
 *
 * Loaded for branch-tracking staff and admins assigned to a branch. The server
 * scopes assigned admins to their own branch's settlement workflow.
 */
interface BranchScopeValue {
  fromBranchId: string; // 'all' | hub id
  toBranchId: string; // 'all' | hub id
  setFromBranchId: (id: string) => void;
  setToBranchId: (id: string) => void;
  branches: Branch[];
  loading: boolean;
  /** Re-fetches the branch list — call after a super_admin creates a branch. */
  refreshBranches: () => Promise<void>;
}

const FROM_KEY = 'branch-scope-from';
const TO_KEY = 'branch-scope-to';

const BranchScopeContext = createContext<BranchScopeValue>({
  fromBranchId: 'all',
  toBranchId: 'all',
  setFromBranchId: () => {},
  setToBranchId: () => {},
  branches: [],
  loading: false,
  refreshBranches: async () => {},
});

export const BranchScopeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { canViewOtherBranches } = useBranchAccess();
  const canUseBranchWorkflow = canViewOtherBranches || Boolean(getCurrentUserLocationId());
  const [fromBranchId, setFromState] = useState<string>(() => localStorage.getItem(FROM_KEY) || 'all');
  const [toBranchId, setToState] = useState<string>(() => localStorage.getItem(TO_KEY) || 'all');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(false);

  const setFromBranchId = useCallback((id: string) => {
    setFromState(id);
    localStorage.setItem(FROM_KEY, id);
  }, []);
  const setToBranchId = useCallback((id: string) => {
    setToState(id);
    localStorage.setItem(TO_KEY, id);
  }, []);

  const refreshBranches = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listBranches();
      setBranches(data);
      // A saved branch that no longer exists falls back to All.
      const exists = (id: string) => id === 'all' || data.some((b) => b.id === id);
      setFromState((cur) => (exists(cur) ? cur : 'all'));
      setToState((cur) => (exists(cur) ? cur : 'all'));
    } catch (err) {
      console.error('Failed to load branches:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- access controls this remote resource
    if (canUseBranchWorkflow) refreshBranches();
  }, [canUseBranchWorkflow, refreshBranches]);

  return (
    <BranchScopeContext.Provider
      value={{ fromBranchId, toBranchId, setFromBranchId, setToBranchId, branches, loading, refreshBranches }}
    >
      {children}
    </BranchScopeContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components -- context hook intentionally colocated
export function useBranchScope(): BranchScopeValue {
  return useContext(BranchScopeContext);
}
