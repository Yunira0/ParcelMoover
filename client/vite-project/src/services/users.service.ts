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

  // Vendor profile
  sales?: string;
  rateType?: string; // per_destination | zone | flat
  // Per-vendor rate overrides (sent as strings; blank → use Settings default)
  flatInsideValley?: string;
  flatOutsideValley?: string;
  zoneMajorCities?: string;
  zoneUrbanAreas?: string;
  zoneRemoteAreas?: string;
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
  rateType?: string;
  flatInsideValley?: string;
  flatOutsideValley?: string;
  zoneMajorCities?: string;
  zoneUrbanAreas?: string;
  zoneRemoteAreas?: string;
  pickupLandmark?: string;
  billingBusinessName?: string;
  registrationNo?: string;
  panVatNo?: string;
  // rider
  riderLocation?: string;
  licenceNo?: string;
  vehicleNo?: string;
  salaryCommission?: string;
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
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
};

export const getAdmins = async () => {
  const response = await api.get('/auth/users/admins'); 
  return response.data;
};

export const getVendors = async () => {
  const response = await api.get('/auth/users/vendors');
  return response.data;
};

export const getRiders = async () => {
  const response = await api.get('/auth/users/riders');
  return response.data;
};

export const getLocations = async () => {
  const response = await api.get('/auth/locations');
  return response.data;
};

export const updateUserProfile = async (id: string, data: UpdateUserProfileInput) => {
  const response = await api.patch(`/auth/users/${data.type}/${id}`, data);
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
