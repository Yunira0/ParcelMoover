// Aligned with the vendor sidebar sections — each permission gates one area.
export const STAFF_PERMISSIONS = [
  "DASHBOARD_ACCESS",
  "ORDER_ACCESS",
  "FINANCE_ACCESS",
  "USER_ACCESS",
  "TICKETS_ACCESS",
  "REMARKS_ACCESS",
  "DELIVERY_CHARGES_ACCESS",
] as const;

export type StaffPermission = (typeof STAFF_PERMISSIONS)[number];

export interface StaffInput {
  name: string;
  email: string;
  permissions: string[];
  enabled?: boolean;
  /** Required on create, optional on update (omit or empty string to keep existing). */
  password?: string;
}
