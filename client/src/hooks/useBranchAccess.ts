import { getCurrentUserRoles, hasAdminPermission } from '../utils/auth';

/**
 * Cross-branch (multi-hub) tracking access for the admin views.
 *
 * Out of the box only a super_admin sees other branches. A super_admin can
 * grant a plain admin one of two levels, mirroring the ADMIN_PERMISSIONS
 * codes:
 *   - BRANCH_TRACKING_READ  — open other-branch views, everything read-only
 *   - BRANCH_TRACKING_WRITE — same views plus acting on another branch's data
 *
 * The server enforces the same rule; this hook drives route visibility and
 * read-only presentation in the UI.
 */
export interface BranchAccess {
  isSuperAdmin: boolean;
  /** May open the Branch Tracking section at all (READ or WRITE, or super_admin). */
  canViewOtherBranches: boolean;
  /** May act on another branch's orders/settlements (WRITE, or super_admin). */
  canWriteOtherBranches: boolean;
}

export function useBranchAccess(): BranchAccess {
  const isSuperAdmin = getCurrentUserRoles().includes('super_admin');
  const canWriteOtherBranches = isSuperAdmin || hasAdminPermission('BRANCH_TRACKING_WRITE');
  const canViewOtherBranches = canWriteOtherBranches || hasAdminPermission('BRANCH_TRACKING_READ');
  return { isSuperAdmin, canViewOtherBranches, canWriteOtherBranches };
}
