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

/** True for a pure sales account — excludes admin/super_admin, who also carry the 'sales' role code when department = Sales but use the admin views. */
export function isSalesUser(): boolean {
  return hasAnyRole(['sales']) && !isAdminSide();
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
export function hasAdminPermission(permission: string): boolean {
  const roles = getCurrentUserRoles();
  if (roles.includes('super_admin')) return true;
  if (!roles.includes('admin')) return false;
  const p = getCurrentUser()?.permissions;
  return Array.isArray(p) && p.includes(permission);
}
