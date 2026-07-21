import api from '../utils/api';

export interface PaymentMethodOption {
  id: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
}

// Lists payment methods. Admins receive the active set; super admins can pass
// includeInactive to manage the full list.
export const getPaymentMethods = async (includeInactive = false): Promise<PaymentMethodOption[]> => {
  const response = await api.get('/payment-methods', {
    params: includeInactive ? { activeOnly: 'false' } : undefined,
  });
  return response.data.data;
};

export const createPaymentMethod = async (name: string): Promise<PaymentMethodOption> => {
  const response = await api.post('/payment-methods', { name });
  return response.data.data;
};

export const setPaymentMethodActive = async (
  id: string,
  isActive: boolean,
): Promise<PaymentMethodOption> => {
  const response = await api.patch(`/payment-methods/${id}`, { isActive });
  return response.data.data;
};
