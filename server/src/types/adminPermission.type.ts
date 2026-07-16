// Privileges a super_admin can delegate to individual admin (staff) accounts.
// Stored on admins.permissions. A super_admin implicitly holds all of them.
export const ADMIN_PERMISSIONS = [
  // Full user management like a super_admin: create/edit any account type
  // (admins included), not just the rider/vendor accounts plain admins get.
  "MANAGE_USERS",
  // Access to the Settings section (destinations, rate setup, delivery rates).
  "SETTINGS_ACCESS",
  // Review (approve/reject) KYC applications - otherwise super_admin-only.
  "KYC_ACCESS",
  // Read the system audit logs - they expose actor identity and raw
  // before/after payloads across every entity, so this is a real grant.
  "SYSTEM_LOGS_ACCESS",
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];
