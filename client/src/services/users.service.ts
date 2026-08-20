import api from '../utils/api';

export interface RegisterUserInput {
  type: 'admin' | 'vendor' | 'rider';
  fullName: string;
  email: string;
  password: string;
  phone?: string;
  position?: string;
  clientName?: string;
  businessName?: string;
  locationId?: string;
  address?: string;
  joinedAt?: string;

  // Shared profile / bank
  pan?: string;
  citizenshipNo?: string;
  bankName?: string;
  bankAccountNo?: string;
  bankAccountHolder?: string;

  // Admin profile
  department?: string;
  idDocumentType?: string;
  idDocumentNumber?: string;
  fatherName?: string;
  motherName?: string;
  grandfatherName?: string;
  permanentAddress?: string;
  currentAddress?: string;
  experience?: string;

  // Rider profile
  riderLocation?: string;
  licenceNo?: string;
  vehicleNo?: string;
  salaryCommission?: string;
  // '' | 'ncm' | 'upaya' — marks this rider as a 3PL placeholder rather than
  // a real employee. Super_admin only.
  carrierCode?: string;

  // Vendor profile
  sales?: string;
  salesUserId?: string;
  rateType?: string; // per_destination | zone | flat
  // Per-vendor rate overrides (sent as strings; blank → use Settings default)
  flatInsideValley?: string;
  flatOutsideValley?: string;
  flatOutsideRingRoad?: string;
  zoneMajorCities?: string;
  zoneUrbanAreas?: string;
  zoneRemoteAreas?: string;
  zoneInsideValley?: string;
  insideValleyFlatRate?: string;
  returnInsideValleyPercent?: string;
  returnOutsideValleyPercent?: string;
  branchFlatInsideValley?: string;
  branchFlatOutsideValley?: string;
  branchFlatOutsideRingRoad?: string;
  branchZoneMajorCities?: string;
  branchZoneUrbanAreas?: string;
  branchZoneRemoteAreas?: string;
  branchZoneInsideValley?: string;
  pickupLandmark?: string;
  billingBusinessName?: string;
  registrationNo?: string;
  panVatNo?: string;

  // Documents (field names must match the server's multer config)
  idDocument?: File | null;
  citizenshipDoc?: File | null;
  panDoc?: File | null;
  panVatDoc?: File | null;
  experienceLetterDoc?: File | null;
  licenceDoc?: File | null;
  bluebookDoc?: File | null;
  businessCertDoc?: File | null;
}

export interface UpdateUserProfileInput {
  type: 'admin' | 'vendor' | 'rider';
  fullName?: string;
  phone?: string;
  email?: string;
  joinedAt?: string;
  locationId?: string;
  address?: string;
  pan?: string;
  citizenshipNo?: string;
  bankName?: string;
  bankAccountNo?: string;
  bankAccountHolder?: string;
  // admin
  position?: string;
  department?: string;
  idDocumentType?: string;
  idDocumentNumber?: string;
  fatherName?: string;
  motherName?: string;
  grandfatherName?: string;
  permanentAddress?: string;
  currentAddress?: string;
  experience?: string;
  // vendor
  clientName?: string;
  businessName?: string;
  sales?: string;
  salesUserId?: string;
  rateType?: string;
  flatInsideValley?: string;
  flatOutsideValley?: string;
  flatOutsideRingRoad?: string;
  zoneMajorCities?: string;
  zoneUrbanAreas?: string;
  zoneRemoteAreas?: string;
  zoneInsideValley?: string;
  insideValleyFlatRate?: string;
  returnInsideValleyPercent?: string;
  returnOutsideValleyPercent?: string;
  branchFlatInsideValley?: string;
  branchFlatOutsideValley?: string;
  branchFlatOutsideRingRoad?: string;
  branchZoneMajorCities?: string;
  branchZoneUrbanAreas?: string;
  branchZoneRemoteAreas?: string;
  branchZoneInsideValley?: string;
  pickupLandmark?: string;
  billingBusinessName?: string;
  registrationNo?: string;
  panVatNo?: string;
  // rider
  riderLocation?: string;
  licenceNo?: string;
  vehicleNo?: string;
  salaryCommission?: string;
  carrierCode?: string;

  // Documents (field names must match the server's multer config). Sent only
  // to fill a slot the account was created without, or to replace an
  // unreadable scan — omitting one leaves the stored document untouched.
  idDocument?: File | null;
  citizenshipDoc?: File | null;
  panDoc?: File | null;
  panVatDoc?: File | null;
  experienceLetterDoc?: File | null;
  licenceDoc?: File | null;
  bluebookDoc?: File | null;
  businessCertDoc?: File | null;
}

export const getManagedUser = async (type: 'admin' | 'vendor' | 'rider', id: string) => {
  const response = await api.get(`/auth/users/${type}/${id}`);
  return response.data;
};

export const registerUser = async (data: RegisterUserInput) => {
  // Sent as multipart/form-data so document files can be uploaded alongside the
  // scalar fields. Only non-empty values are appended.
  const form = new FormData();
  Object.entries(data).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (value instanceof File) {
      form.append(key, value);
    } else {
      form.append(key, String(value));
    }
  });

  const response = await api.post('/auth/users/register', form, {
    // Header override required: the api instance defaults to Content-Type:
    // application/json, which makes axios serialise FormData to JSON instead of
    // multipart - the File would silently become {} and multer would never see
    // it. See billing.service.ts's payment upload for the same fix.
    headers: { 'Content-Type': 'multipart/form-data' },
    // Multipart uploads can be slow on production networks, especially with
    // camera-shot KYC images. Give this write a longer timeout than normal
    // JSON requests.
    timeout: 120000,
  });
  return response.data;
};

export const getAdmins = async (params?: {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
}) => {
  const response = await api.get('/auth/users/admins', { params });
  return response.data;
};

export const getVendors = async (params?: {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  company?: string;
  location?: string;
}) => {
  const response = await api.get('/auth/users/vendors', { params });
  return response.data;
};

export const getTopVendors = async () => {
  const response = await api.get('/auth/users/vendors/top');
  return response.data;
};

export const searchVendors = async (search: string, limit = 50, offset = 0) => {
  const response = await api.get('/auth/users/vendors/dropdown', {
    params: { search, limit, offset },
  });
  return response.data;
};

export const getRiders = async (params?: {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
}) => {
  const response = await api.get('/auth/users/riders', { params });
  return response.data;
};

export interface ManagedUserDocument {
  key: string;
  label: string;
  /** Relative "uploads/..." path; the /uploads route decrypts and serves it. */
  path: string;
}

/** Documents uploaded on the registration form for one admin/vendor/rider. */
export const getUserDocuments = async (
  type: UpdateUserProfileInput['type'],
  id: string,
): Promise<{
  success: boolean;
  data?: { type: string; id: string; name: string; documents: ManagedUserDocument[] };
  message?: string;
}> => {
  const response = await api.get(`/auth/users/${type}/${id}/documents`);
  return response.data;
};

export const getLocations = async () => {
  const response = await api.get('/auth/locations');
  return response.data;
};

export const updateUserProfile = async (id: string, data: UpdateUserProfileInput) => {
  const files = Object.values(data).filter((value): value is File => value instanceof File);

  // Plain edits stay JSON; only an edit carrying documents pays for multipart.
  if (files.length === 0) {
    const response = await api.patch(`/auth/users/${data.type}/${id}`, data);
    return response.data;
  }

  const form = new FormData();
  Object.entries(data).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (value instanceof File) form.append(key, value);
    // Unlike registerUser, "" is kept: the update service reads a blank field
    // as "clear this value", and dropping it would silently ignore the edit.
    else form.append(key, String(value));
  });

  const response = await api.patch(`/auth/users/${data.type}/${id}`, form, {
    // Same Content-Type override registerUser needs — the api instance
    // defaults to JSON, which would serialise the File to {}.
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  });
  return response.data;
};

/** Activate/deactivate an account. Deactivation also blocks the user's login. */
export const updateUserStatus = async (
  type: UpdateUserProfileInput['type'],
  id: string,
  status: 'active' | 'inactive',
) => {
  const response = await api.patch(`/auth/users/${type}/${id}`, { status });
  return response.data;
};

export const updateUserPassword = async (
  type: UpdateUserProfileInput['type'],
  id: string,
  password: string,
) => {
  const response = await api.patch(`/auth/users/${type}/${id}/password`, { password });
  return response.data;
};

// ── Delegated admin permissions (super_admin only) ────────────────────────────

/** Privileges a super_admin can delegate to an admin account. */
export const ADMIN_PERMISSIONS = [
  { code: 'MANAGE_USERS', label: 'User Management', description: 'Create and manage every account type, including other admins.' },
  { code: 'SETTINGS_ACCESS', label: 'Settings', description: 'Access the Settings section: destinations, rate setup and delivery rates.' },
  { code: 'KYC_ACCESS', label: 'KYC Applications', description: 'Review, approve and reject vendor KYC applications.' },
  { code: 'SYSTEM_LOGS_ACCESS', label: 'System Logs', description: 'Read the system audit logs, including who changed what across the app.' },
  { code: 'EDIT_SETTLEMENTS', label: 'Edit COD Statements', description: 'Correct an unsettled COD statement (add/remove orders) before it is paid out.' },
  { code: 'ACCOUNTING_ACCESS', label: 'Finance', description: 'The whole Finance section: the books, party balances and reports, plus recording expenses, posting journal entries and closing a month. This is the full financial picture of the business.' },
  { code: 'EDIT_COD_LOCKED', label: 'Edit COD (any status)', description: 'Correct the COD amount on a delivered, returned-to-vendor, or RTO parcel, as long as it hasn’t been settled to the vendor yet.' },
] as const;

export type AdminPermissionCode = (typeof ADMIN_PERMISSIONS)[number]['code'];

/** Replaces the admin's whole delegated-permission list. */
export const updateAdminPermissions = async (adminId: string, permissions: string[]) => {
  const response = await api.patch(`/auth/users/admins/${adminId}/permissions`, { permissions });
  return response.data;
};

/** Super_admin only: grant or revoke the super_admin role on another admin account. */
export const updateAdminRole = async (adminId: string, superAdmin: boolean) => {
  const response = await api.patch(`/auth/users/admins/${adminId}/role`, { superAdmin });
  return response.data;
};
