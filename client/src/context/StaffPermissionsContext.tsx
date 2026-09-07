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
    const persist = (
      perms: string[],
      profile?: { branchScoped?: boolean; hubId?: string | null; hubName?: string | null },
    ) => {
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

    if (isStaff) {
      getMyPermissions().then(persist).catch((err) => {
        console.error('Failed to refresh staff permissions:', err);
      });
    } else if (isPlainAdmin) {
      // /me returns the admin's current delegated permission list, so a grant
      // made by the super_admin lands on the next page load, not next login.
      fetchMe()
        .then((me) => persist(Array.isArray(me?.permissions) ? me.permissions : [], me))
        .catch((err) => {
          console.error('Failed to refresh admin permissions:', err);
        });
    }
  }, [isStaff, isPlainAdmin]);

  return (
    <StaffPermissionsContext.Provider value={permissions}>
      {children}
    </StaffPermissionsContext.Provider>
  );
};

export function useStaffPermissions(): string[] {
  return useContext(StaffPermissionsContext);
}
