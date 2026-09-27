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
  // Money corrections: edit, cancel or revert a COD statement (add/remove
  // orders before it is paid, undo a mistaken payment), and correct the COD
  // on a delivered/RTV/RTO parcel that is not yet on a statement.
  "EDIT_SETTLEMENTS",
  // The whole Finance section: reading the books (journal, account ledgers,
  // trial balance, party subledgers, P&L and balance sheet), writing to them
  // (expenses, manual entries, reversals), closing a BS month, and editing the
  // chart of accounts and opening balances (Masters).
  //
  // Reading, writing and closing were three separate grants once. They are one
  // now because nobody was ever given the reports without also being given the
  // ability to post - the split cost a decision at every grant and bought
  // nothing. It is still a real grant, not an open door: this is the whole
  // financial picture of the business across every vendor and rider, so it is
  // delegated deliberately, the same reasoning as SYSTEM_LOGS_ACCESS.
  "ACCOUNTING_ACCESS",
  // Cross-branch operational visibility. WRITE includes READ in
  // hasAdminPermission so a writer never needs both strings persisted.
  "BRANCH_TRACKING_READ",
  "BRANCH_TRACKING_WRITE",
  // Force a parcel into any status from any status, bypassing the transition
  // map and the terminal-state lock - the same override a super_admin has.
  "FORCE_STATUS_CHANGE",
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];
