export interface CurrentUser {
  id: string;
  email: string;
  fullName: string;
  roles: string[];
  /** True when the user logged in with a temporary password and must set a new one. */
  mustChangePassword?: boolean;
  /**
   * Present for vendor_staff (codes granted by their vendor) and for plain
   * admins (codes delegated by a super_admin, e.g. MANAGE_USERS).
   */
  permissions?: string[];
  /** An admin/super_admin's own assigned hub, if any. Branch COD has a fixed
   *  receiving master (Imadol), independent of this profile assignment. */
  locationId?: string | null;
  /** Human-readable name of the admin's assigned branch. */
  locationName?: string | null;
  /**
   * True for a branch workspace account. These admins operate only inside
   * their assigned branch instead of receiving the full head-office shell.
   */
  branchScoped?: boolean;
}

export function getCurrentUser(): CurrentUser | null {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null');
  } catch {
    return null;
  }
}

export function getCurrentUserRoles(): string[] {
  const roles = getCurrentUser()?.roles;
  return Array.isArray(roles) ? roles : [];
}

export function hasAnyRole(allowedRoles: string[]): boolean {
  const roles = getCurrentUserRoles();
  return roles.some((role) => allowedRoles.includes(role));
}

/** True for vendor owners AND vendor staff — use instead of bare roles.includes('vendor'). */
export function isVendorSide(): boolean {
  return hasAnyRole(['vendor', 'vendor_staff']);
}

/** True for super_admin and admin only. */
export function isAdminSide(): boolean {
  return hasAnyRole(['super_admin', 'admin']);
}

/** True only for a branch-scoped plain admin, never a head-office super admin. */
export function isBranchWorkspaceUser(): boolean {
  const user = getCurrentUser();
  if (!user) return false;
  return (
    user.branchScoped === true &&
    user.roles.includes('admin') &&
    !user.roles.includes('super_admin')
  );
}

/** Routes that belong to the intentionally small assigned-branch workspace. */
export function isBranchWorkspacePathAllowed(pathname: string): boolean {
  return (
    pathname === '/dashboard' ||
    pathname === '/orders' ||
    pathname === '/orders/create' ||
    pathname === '/orders/bulk-create' ||
    pathname.startsWith('/orders/track/') ||
    // Branch onboards and manages its own vendors; the vendor APIs scope a
    // branch-scoped admin to vendors registered at their branch.
    pathname === '/vendors' ||
    pathname.startsWith('/vendors/') ||
    pathname === '/merchant-overview' ||
    // Branch runs its own pickup, dispatch, transit and return desks; the order
    // APIs behind these pages scope a branch-scoped admin to their own branch.
    pathname === '/pickup' ||
    pathname === '/dispatch' ||
    pathname === '/oov' ||
    pathname === '/return' ||
    pathname === '/hold' ||
    // Branch manages its own riders and settles their COD; the rider APIs
    // behind these pages scope a branch-scoped admin to their branch's riders.
    pathname === '/riders' ||
    pathname.startsWith('/riders/') ||
    pathname === '/accounting/transactions/rider-cod' ||
    pathname.startsWith('/finance/settlements/') ||
    // Support desk for the branch's own parcels / staff.
    pathname === '/tickets' ||
    pathname.startsWith('/tickets/') ||
    pathname === '/remarks' ||
    pathname.startsWith('/remarks/') ||
    pathname === '/branches/settlement' ||
    // Includes /branches/settlement/new — a branch creates its own COD statement.
    pathname.startsWith('/branches/settlement/') ||
    pathname === '/branches/billing' ||
    // Route Rates, scoped server-side to routes originating from the
    // branch's own hub; only reachable at all if a super_admin also
    // granted this admin SETTINGS_ACCESS.
    pathname === '/settings/delivery-rates'
  );
}

/** True for a pure sales account — excludes admin/super_admin, who also carry the 'sales' role code when department = Sales but use the admin views. */
export function isSalesUser(): boolean {
  return hasAnyRole(['sales']) && !isAdminSide();
}

/** Roles that actually have a web (admin/vendor/sales) experience. */
const WEB_ROLES = ['super_admin', 'admin', 'sales', 'vendor', 'vendor_staff'];

/**
 * True for a rider who has no web-facing role. Riders use the dedicated Rider
 * app; on the web they must be blocked rather than falling through to the
 * admin views.
 */
export function isRiderOnly(): boolean {
  const roles = getCurrentUserRoles();
  return roles.includes('rider') && !roles.some((r) => WEB_ROLES.includes(r));
}

/** Returns the staff permission codes for the current vendor_staff user. */
export function getStaffPermissions(): string[] {
  const p = getCurrentUser()?.permissions;
  return Array.isArray(p) ? p : [];
}

export function hasStaffPermission(permission: string): boolean {
  return getStaffPermissions().includes(permission);
}

/**
 * Delegated admin privileges (MANAGE_USERS, SETTINGS_ACCESS). A super_admin
 * implicitly holds all of them; a plain admin only what a super_admin granted.
 */
/** The current admin/super_admin's own assigned hub, or null if they have none. */
export function getCurrentUserLocationId(): string | null {
  return getCurrentUser()?.locationId ?? null;
}

export function hasAdminPermission(permission: string): boolean {
  const roles = getCurrentUserRoles();
  if (roles.includes('super_admin')) return true;
  if (!roles.includes('admin')) return false;
  const p = getCurrentUser()?.permissions;
  return Array.isArray(p) && p.includes(permission);
}
