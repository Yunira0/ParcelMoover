import api from '../utils/api';

export type StaffPermission =
  | 'DASHBOARD_ACCESS'
  | 'ORDER_ACCESS'
  | 'FINANCE_ACCESS'
  | 'USER_ACCESS'
  | 'TICKETS_ACCESS'
  | 'REMARKS_ACCESS'
  | 'DELIVERY_CHARGES_ACCESS';

export interface Staff {
  id: string;
  name: string;
  email: string;
  permissions: StaffPermission[];
  enabled: boolean;
}

export interface StaffInput {
  name: string;
  email: string;
  permissions: StaffPermission[];
  enabled: boolean;
  /** Required on create. Optional on edit — leave blank to keep the existing password. */
  password?: string;
}

export const STAFF_PERMISSIONS: { value: StaffPermission; label: string }[] = [
  { value: 'DASHBOARD_ACCESS', label: 'Dashboard' },
  { value: 'ORDER_ACCESS', label: 'Orders' },
  { value: 'FINANCE_ACCESS', label: 'Finance' },
  { value: 'USER_ACCESS', label: 'User Management' },
  { value: 'TICKETS_ACCESS', label: 'Tickets' },
  { value: 'REMARKS_ACCESS', label: 'Remarks' },
  { value: 'DELIVERY_CHARGES_ACCESS', label: 'Delivery Charges' },
];

export const PERMISSION_LABELS: Record<StaffPermission, string> = STAFF_PERMISSIONS.reduce(
  (acc, p) => ({ ...acc, [p.value]: p.label }),
  {} as Record<StaffPermission, string>,
);

export const getMyPermissions = async (): Promise<string[]> => {
  const response = await api.get('/staff/me');
  return response.data.data.permissions;
};

export const getStaff = async (): Promise<Staff[]> => {
  const response = await api.get('/staff');
  return response.data.data;
};

export const createStaff = async (input: StaffInput): Promise<Staff> => {
  const response = await api.post('/staff', input);
  return response.data.data;
};

export const updateStaff = async (id: string, input: StaffInput): Promise<Staff> => {
  const response = await api.patch(`/staff/${id}`, input);
  return response.data.data;
};

export const setStaffEnabled = async (id: string, enabled: boolean): Promise<Staff> => {
  const response = await api.patch(`/staff/${id}/status`, { enabled });
  return response.data.data;
};
