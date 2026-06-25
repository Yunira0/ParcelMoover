export interface CurrentUser {
  id: string;
  email: string;
  fullName: string;
  roles: string[];
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
