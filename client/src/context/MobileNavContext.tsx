import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

interface MobileNavCtx {
  mobileOpen: boolean;
  toggleMobile: () => void;
  closeMobile: () => void;
}

const MobileNavContext = createContext<MobileNavCtx>({
  mobileOpen: false,
  toggleMobile: () => {},
  closeMobile: () => {},
});

export const MobileNavProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  // Navigating away should always close the drawer - it should never persist
  // open across routes, and NavLink clicks inside it are how users navigate.
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const toggleMobile = useCallback(() => setMobileOpen((open) => !open), []);
  const closeMobile = useCallback(() => setMobileOpen(false), []);

  return (
    <MobileNavContext.Provider value={{ mobileOpen, toggleMobile, closeMobile }}>
      {children}
    </MobileNavContext.Provider>
  );
};

export function useMobileNav(): MobileNavCtx {
  return useContext(MobileNavContext);
}
