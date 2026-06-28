export interface CurrentUser {
  id: string;
  email: string;
  fullName: string;
  roles: string[];
  /** True when the user logged in with a temporary password and must set a new one. */
  mustChangePassword?: boolean;
  /** Present only for vendor_staff — the permission codes granted by their vendor. */
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

/** Returns the staff permission codes for the current vendor_staff user. */
export function getStaffPermissions(): string[] {
  const p = getCurrentUser()?.permissions;
  return Array.isArray(p) ? p : [];
}

export function hasStaffPermission(permission: string): boolean {
  return getStaffPermissions().includes(permission);
}
