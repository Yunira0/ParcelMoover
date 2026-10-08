import api from '../utils/api';

const API_ROOT = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');

export type BannerDisplayType = 'modal' | 'permanent';
export type BannerStatus = 'draft' | 'scheduled' | 'live' | 'expired';

export interface Banner {
  id: string;
  name: string;
  imagePath: string;
  linkUrl: string | null;
  displayType: BannerDisplayType;
  isEnabled: boolean;
  startsAt: string | null;
  endsAt: string | null;
  sortOrder: number;
  status: BannerStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ActiveBanners {
  modal: Banner | null;
  permanent: Banner | null;
}

// imagePath doubles as a cache-buster the same way paymentQrUrl does: a
// replaced image gets a fresh random filename, so keying the URL on it forces
// a refetch instead of the browser reusing a stale cached banner forever.
export const bannerImageUrl = (id: string, imagePath: string): string =>
  `${API_ROOT}/banners/${id}/image?v=${encodeURIComponent(imagePath)}`;

export const listBanners = async (): Promise<Banner[]> => {
  const response = await api.get('/banners');
  return response.data.data;
};

// No single-banner GET on the server — the admin list is never large enough
// to matter, so the edit page just finds its row in it (works fine on a
// direct URL / refresh too, since this still hits the server fresh).
export const getBanner = async (id: string): Promise<Banner> => {
  const banners = await listBanners();
  const found = banners.find((b) => b.id === id);
  if (!found) throw new Error('Banner not found');
  return found;
};

export const getActiveBanners = async (): Promise<ActiveBanners> => {
  const response = await api.get('/banners/active');
  return response.data.data;
};

export interface BannerInput {
  name: string;
  linkUrl?: string | null;
  displayType: BannerDisplayType;
  isEnabled: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  sortOrder?: number;
}

function toFormData(input: Partial<BannerInput>, image?: File | null): FormData {
  const form = new FormData();
  if (input.name !== undefined) form.append('name', input.name);
  if (input.linkUrl !== undefined) form.append('linkUrl', input.linkUrl ?? '');
  if (input.displayType !== undefined) form.append('displayType', input.displayType);
  if (input.isEnabled !== undefined) form.append('isEnabled', String(input.isEnabled));
  if (input.startsAt !== undefined) form.append('startsAt', input.startsAt ?? '');
  if (input.endsAt !== undefined) form.append('endsAt', input.endsAt ?? '');
  if (input.sortOrder !== undefined) form.append('sortOrder', String(input.sortOrder));
  if (image) form.append('image', image);
  return form;
}

export const createBanner = async (input: BannerInput, image: File): Promise<Banner> => {
  const form = toFormData(input, image);
  const response = await api.post('/banners', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data.data;
};

export const updateBanner = async (
  id: string,
  input: Partial<BannerInput>,
  image?: File | null,
): Promise<Banner> => {
  const form = toFormData(input, image);
  const response = await api.patch(`/banners/${id}`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data.data;
};

export const deleteBanner = async (id: string): Promise<void> => {
  await api.delete(`/banners/${id}`);
};
