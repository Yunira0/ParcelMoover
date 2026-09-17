import api from '../utils/api';

export interface KycApplicationInput {
  // Business Details
  onlineBusinessName: string;
  pickupLocation: string;
  pickupLandmark?: string;
  businessContact: string;

  // Owner / Contact Person
  ownerName: string;
  ownerEmail: string;
  ownerContact: string;

  // Billing Details
  billingBusinessName?: string;
  registeredAddress?: string;
  registrationNo?: string;
  panVatNo?: string;

  // Documents
  citizenshipDocFront?: File | null;
  citizenshipDocBack?: File | null;
  panVatDoc?: File | null;
  businessCertDoc?: File | null;

  // Bank Details
  bankName: string;
  bankAccountNo: string;
  bankAccountHolder: string;
}

export interface KycApplication {
  id: string;
  sn: number;
  status: 'pending' | 'approved' | 'rejected';
  /** Verification = an existing vendor proving itself; onboarding = a brand-new vendor. */
  applicationType: 'verification' | 'onboarding';
  vendorId: string | null;
  vendorName: string | null;
  onlineBusinessName: string;
  pickupLocation: string;
  pickupLandmark: string | null;
  businessContact: string;
  ownerName: string;
  ownerEmail: string;
  ownerContact: string;
  billingBusinessName: string | null;
  registeredAddress: string | null;
  registrationNo: string | null;
  panVatNo: string | null;
  citizenshipDocFront: string | null;
  citizenshipDocBack: string | null;
  panVatDoc: string | null;
  businessCertDoc: string | null;
  bankName: string | null;
  bankAccountNo: string | null;
  bankAccountHolder: string | null;
  rejectionReason: string | null;
  notes: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export const submitKycApplication = async (data: KycApplicationInput) => {
  const form = new FormData();

  form.append('onlineBusinessName', data.onlineBusinessName);
  form.append('pickupLocation', data.pickupLocation);
  if (data.pickupLandmark) form.append('pickupLandmark', data.pickupLandmark);
  form.append('businessContact', data.businessContact);
  form.append('ownerName', data.ownerName);
  form.append('ownerEmail', data.ownerEmail);
  form.append('ownerContact', data.ownerContact);
  if (data.billingBusinessName) form.append('billingBusinessName', data.billingBusinessName);
  if (data.registeredAddress) form.append('registeredAddress', data.registeredAddress);
  if (data.registrationNo) form.append('registrationNo', data.registrationNo);
  if (data.panVatNo) form.append('panVatNo', data.panVatNo);
  form.append('bankName', data.bankName);
  form.append('bankAccountNo', data.bankAccountNo);
  form.append('bankAccountHolder', data.bankAccountHolder);
  if (data.citizenshipDocFront) form.append('citizenshipDocFront', data.citizenshipDocFront);
  if (data.citizenshipDocBack) form.append('citizenshipDocBack', data.citizenshipDocBack);
  if (data.panVatDoc) form.append('panVatDoc', data.panVatDoc);
  if (data.businessCertDoc) form.append('businessCertDoc', data.businessCertDoc);

  const response = await api.post('/kyc/apply', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
};

export const getKycApplications = async (status?: string, page?: number, pageSize?: number) => {
  const params: Record<string, string | number> = {};
  if (status && status !== 'all') params.status = status;
  if (page) params.page = page;
  if (pageSize) params.pageSize = pageSize;
  const response = await api.get('/kyc/applications', { params });
  return response.data;
};

export const approveKyc = async (id: string, notes?: string) => {
  const response = await api.patch(`/kyc/applications/${id}/approve`, { notes });
  return response.data;
};

export const rejectKyc = async (id: string, rejectionReason: string, notes?: string) => {
  const response = await api.patch(`/kyc/applications/${id}/reject`, { rejectionReason, notes });
  return response.data;
};

/** Staff start verification for an existing vendor from Vendor Management. */
export const startVendorKycVerification = async (
  vendorId: string,
  fields: Record<string, string> = {},
  docs: { citizenshipDoc?: File | null; panVatDoc?: File | null; businessCertDoc?: File | null } = {},
): Promise<{
  id: string; status: string; vendorId: string; vendorName: string; createdAt: string;
}> => {
  const form = new FormData();
  form.append('vendorId', vendorId);
  for (const [key, value] of Object.entries(fields)) {
    if (value.trim()) form.append(key, value);
  }
  if (docs.citizenshipDoc) form.append('citizenshipDoc', docs.citizenshipDoc);
  if (docs.panVatDoc) form.append('panVatDoc', docs.panVatDoc);
  if (docs.businessCertDoc) form.append('businessCertDoc', docs.businessCertDoc);
  return (await api.post('/kyc/applications/start', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })).data.data;
};

export interface VerificationPrefill {
  hasApprovedKyc: boolean;
  pendingApplication: { id: string; createdAt: string } | null;
  profile: Record<
    'onlineBusinessName' | 'pickupLocation' | 'pickupLandmark' | 'businessContact' |
    'ownerName' | 'ownerEmail' | 'ownerContact' | 'billingBusinessName' |
    'registeredAddress' | 'registrationNo' | 'panVatNo' |
    'bankName' | 'bankAccountNo' | 'bankAccountHolder',
    string
  >;
  docsOnFile: { citizenship: boolean; panVat: boolean; businessCert: boolean };
}

/** Whether this vendor can claim vouchers yet, with the verification prefill. */
export const getMyKycStatus = async (): Promise<VerificationPrefill> =>
  (await api.get('/kyc/my-status')).data.data;

/** Staff prefill for the manual start form. */
export const getVerificationPrefill = async (vendorId: string): Promise<VerificationPrefill> =>
  (await api.get('/kyc/verification-prefill', { params: { vendorId } })).data.data;

// Multipart because of the optional document scans.
export const submitMyKycVerification = async (
  fields: Record<string, string>,
  docs: { citizenshipDoc?: File | null; panVatDoc?: File | null; businessCertDoc?: File | null },
): Promise<{ id: string }> => {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value.trim()) form.append(key, value);
  }
  if (docs.citizenshipDoc) form.append('citizenshipDoc', docs.citizenshipDoc);
  if (docs.panVatDoc) form.append('panVatDoc', docs.panVatDoc);
  if (docs.businessCertDoc) form.append('businessCertDoc', docs.businessCertDoc);
  const response = await api.post('/kyc/my-application', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data.data;
};
