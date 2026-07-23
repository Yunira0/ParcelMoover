import api from '../utils/api';

export interface PickupTimeSlot {
  id: string;
  label: string;
  startMinutes: number;
  endMinutes: number;
  cutoffMinutes: number;
  isActive: boolean;
  sortOrder: number;
}

export interface PickupTimeSlotInput {
  startMinutes: number;
  endMinutes: number;
}

// Active slots only — used by the vendor-side ticket-creation form.
export const getActivePickupTimeSlots = async (): Promise<{ success: boolean; data: PickupTimeSlot[] }> => {
  const response = await api.get('/pickup-time-slots');
  return response.data;
};

// All slots incl. inactive — used by the super-admin settings page.
export const getAllPickupTimeSlots = async (): Promise<{ success: boolean; data: PickupTimeSlot[] }> => {
  const response = await api.get('/pickup-time-slots/admin');
  return response.data;
};

export const createPickupTimeSlot = async (data: PickupTimeSlotInput) => {
  const response = await api.post('/pickup-time-slots', data);
  return response.data;
};

export const updatePickupTimeSlot = async (
  id: string,
  data: Partial<PickupTimeSlotInput> & { isActive?: boolean },
) => {
  const response = await api.patch(`/pickup-time-slots/${id}`, data);
  return response.data;
};

export const deletePickupTimeSlot = async (id: string) => {
  const response = await api.delete(`/pickup-time-slots/${id}`);
  return response.data;
};
