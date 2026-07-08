import React, { createContext, useContext, useEffect, useState } from 'react';
import { getCurrentUser } from '../utils/auth';
import { getMyPermissions } from '../services/staff.service';

const StaffPermissionsContext = createContext<string[]>([]);

export const StaffPermissionsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const user = getCurrentUser();
  const isStaff = user?.roles.includes('vendor_staff') ?? false;

  const [permissions, setPermissions] = useState<string[]>(
    isStaff ? (user?.permissions ?? []) : [],
  );

  useEffect(() => {
    if (!isStaff) return;
    getMyPermissions()
      .then((perms) => {
        setPermissions(perms);
        const stored = JSON.parse(localStorage.getItem('user') || 'null');
        if (stored) {
          localStorage.setItem('user', JSON.stringify({ ...stored, permissions: perms }));
        }
      })
      .catch((err) => {
        console.error('Failed to refresh staff permissions:', err);
      });
  }, [isStaff]);

  return (
    <StaffPermissionsContext.Provider value={permissions}>
      {children}
    </StaffPermissionsContext.Provider>
  );
};

export function useStaffPermissions(): string[] {
  return useContext(StaffPermissionsContext);
}
