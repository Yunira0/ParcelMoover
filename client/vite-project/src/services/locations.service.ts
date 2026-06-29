import api from '../utils/api';

export interface ManagedLocation {
  id: string;
  parentId: string | null;
  name: string;
  code: string | null;
  province: string | null;
  district: string | null;
  city: string | null;
  addressLine: string | null;
  isHub: boolean;
  isActive: boolean;
  zone: string | null; // major_cities | urban_areas | remote_areas
  valley: string | null; // inside | outside
  perDestinationRate: number | null;
}

export interface Destination extends ManagedLocation {
  areas: ManagedLocation[];
}

export interface UpsertLocationInput {
  name: string;
  code?: string | null;
  province?: string | null;
  district?: string | null;
  city?: string | null;
  addressLine?: string | null;
  isHub?: boolean;
  parentId?: string | null;
  isActive?: boolean;
  zone?: string | null;
  valley?: string | null;
  perDestinationRate?: number | null;
}

export const listManagedLocations = async (): Promise<{ success: boolean; data: Destination[] }> => {
  const response = await api.get('/locations');
  return response.data;
};

export const createLocation = async (data: UpsertLocationInput) => {
  const response = await api.post('/locations', data);
  return response.data;
};

export const updateLocation = async (id: string, data: Partial<UpsertLocationInput>) => {
  const response = await api.patch(`/locations/${id}`, data);
  return response.data;
};
