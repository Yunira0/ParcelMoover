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
  branchPerDestinationRate: number | null;
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
  branchPerDestinationRate?: number | null;
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

export const deleteLocation = async (id: string): Promise<{ success: boolean; message: string }> => {
  const response = await api.delete(`/locations/${id}`);
  return response.data;
};

export interface BulkImportDestinationInput {
  name: string;
  code?: string;
  province?: string;
  district?: string;
  /** Stored server-side in the locations.city column. */
  municipality?: string;
  zone?: string;
  valley?: string;
  perDestinationRate?: number | null;
  /** Rate for branch delivery (parcel dropped at the branch, not the door). */
  branchPerDestinationRate?: number | null;
  areas: string[];
}

export interface BulkImportResult {
  destination: string;
  action: 'created' | 'updated';
  areasCreated: string[];
  areasSkipped: string[];
  error?: string;
}

export const bulkImportLocations = async (
  rows: BulkImportDestinationInput[],
): Promise<{ success: boolean; message: string; data: BulkImportResult[] }> => {
  const response = await api.post('/locations/bulk-import', rows);
  return response.data;
};
