import api from '../utils/api';

export interface Bank {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
}

// Every bank, disabled ones included - a vendor saved with a since-disabled
// bank still needs its code. Pickers filter on isActive themselves.
export const getBanks = async (): Promise<Bank[]> => (await api.get('/banks')).data.data;

export const createBank = async (input: { name: string; code: string }): Promise<Bank> =>
  (await api.post('/banks', input)).data.data;

export const updateBank = async (id: string, input: { code?: string; isActive?: boolean }): Promise<Bank> =>
  (await api.patch(`/banks/${id}`, input)).data.data;
