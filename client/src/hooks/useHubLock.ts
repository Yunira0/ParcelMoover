import { useEffect, useState } from 'react';
import { getCurrentUser as fetchMe } from '../services/auth.service';
import { getCurrentUserRoles } from '../utils/auth';

/**
 * Hub inheritance for creation forms: everything a plain admin creates lands
 * in that admin's own hub (e.g. an Imadol admin's vendors/riders/admins/order
 * origins are all Imadol) — only a super_admin may pick another hub. The
 * server enforces the same rule; this hook drives the matching form UX.
 *
 * Returns the staff user's own hub id (loaded from /me) and whether hub
 * fields must be locked to it. A plain admin without an assigned hub keeps a
 * free choice — there is nothing to lock to.
 */
export function useHubLock() {
  const roles = getCurrentUserRoles();
  const isSuperAdmin = roles.includes('super_admin');
  const isStaff = isSuperAdmin || roles.includes('admin');
  const [myHubId, setMyHubId] = useState('');

  useEffect(() => {
    if (!isStaff) return;
    fetchMe()
      .then((data) => setMyHubId(data.hubId ?? ''))
      .catch(() => {});
    // roles come from localStorage and are stable for the session
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hubLocked = isStaff && !isSuperAdmin && !!myHubId;
  // Edit forms: the server ignores hub changes from any non-super admin, so
  // the field must read as locked even when the editor has no hub of their own.
  const isPlainAdmin = isStaff && !isSuperAdmin;
  return { myHubId, hubLocked, isPlainAdmin, isSuperAdmin, isStaff };
}
