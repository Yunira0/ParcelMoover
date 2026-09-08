import React, { createContext, useContext, useEffect, useState } from 'react';
import { getCurrentUser, isBranchWorkspacePathAllowed } from '../utils/auth';
import { getMyPermissions } from '../services/staff.service';
import { getCurrentUser as fetchMe } from '../services/auth.service';

const StaffPermissionsContext = createContext<string[]>([]);

export const StaffPermissionsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const user = getCurrentUser();
  const isStaff = user?.roles.includes('vendor_staff') ?? false;
  // Plain admins carry delegated permissions (MANAGE_USERS / SETTINGS_ACCESS)
  // granted by a super_admin; refresh them the same way vendor staff are.
  const isPlainAdmin =
    (user?.roles.includes('admin') ?? false) && !(user?.roles.includes('super_admin') ?? false);

  const [permissions, setPermissions] = useState<string[]>(
    isStaff || isPlainAdmin ? (user?.permissions ?? []) : [],
  );

  useEffect(() => {
    let active = true;

    const persist = (
      perms: string[],
      profile?: { branchScoped?: boolean; hubId?: string | null; hubName?: string | null },
    ) => {
      if (!active) return;
      setPermissions(perms);
      const stored = JSON.parse(localStorage.getItem('user') || 'null');
      if (stored) {
        const nextUser = {
          ...stored,
          permissions: perms,
          ...(profile && {
            branchScoped: profile.branchScoped === true,
            locationId: profile.hubId ?? null,
            locationName: profile.hubName ?? null,
          }),
        };
        localStorage.setItem('user', JSON.stringify(nextUser));

        // Existing admin sessions may predate branchScoped being included in
        // the login payload. Once /me refreshes that flag, leave any open
        // head-office screen immediately instead of waiting for the next login.
        if (
          profile?.branchScoped === true &&
          !isBranchWorkspacePathAllowed(window.location.pathname)
        ) {
          window.location.replace('/orders');
        }
      }
    };

    const refresh = () => {
      if (isStaff) {
        getMyPermissions().then(persist).catch((err) => {
          console.error('Failed to refresh staff permissions:', err);
        });
      } else if (isPlainAdmin) {
        // /me is authoritative for both delegated permissions and branch
        // scope. Re-read it whenever this tab becomes active so a change made
        // by a super admin in another browser/profile takes effect without the
        // branch operator having to log out first.
        fetchMe()
          .then((me) => persist(Array.isArray(me?.permissions) ? me.permissions : [], me))
          .catch((err) => {
            console.error('Failed to refresh admin permissions:', err);
          });
      }
    };

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };

    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refreshWhenVisible);

    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [isStaff, isPlainAdmin]);

  useEffect(() => {
    // Cookies and localStorage are shared by tabs in the same browser profile.
    // If another tab logs in or out, reload this shell immediately instead of
    // leaving controls from the previous account visible against the new
    // server session.
    const syncCrossTabSession = (event: StorageEvent) => {
      if (event.key === 'user') window.location.reload();
    };

    window.addEventListener('storage', syncCrossTabSession);
    return () => window.removeEventListener('storage', syncCrossTabSession);
  }, []);

  return (
    <StaffPermissionsContext.Provider value={permissions}>
      {children}
    </StaffPermissionsContext.Provider>
  );
};

export function useStaffPermissions(): string[] {
  return useContext(StaffPermissionsContext);
}
