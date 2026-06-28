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
  citizenshipDoc?: File | null;
  panVatDoc?: File | null;
  businessCertDoc?: File | null;

  // Bank Details
  bankName?: string;
  bankAccountNo?: string;
  bankAccountHolder?: string;
}

export interface KycApplication {
  id: string;
  sn: number;
  status: 'pending' | 'approved' | 'rejected';
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
  citizenshipDoc: string | null;
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
  if (data.bankName) form.append('bankName', data.bankName);
  if (data.bankAccountNo) form.append('bankAccountNo', data.bankAccountNo);
  if (data.bankAccountHolder) form.append('bankAccountHolder', data.bankAccountHolder);
  if (data.citizenshipDoc) form.append('citizenshipDoc', data.citizenshipDoc);
  if (data.panVatDoc) form.append('panVatDoc', data.panVatDoc);
  if (data.businessCertDoc) form.append('businessCertDoc', data.businessCertDoc);

  const response = await api.post('/kyc/apply', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
};

export const getKycApplications = async (status?: string) => {
  const params = status && status !== 'all' ? { status } : {};
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
