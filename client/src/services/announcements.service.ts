import api from '../utils/api';

export type AnnouncementStatus = 'draft' | 'scheduled' | 'live' | 'expired';

export interface Announcement {
  id: string;
  title: string;
  body: string;
  isEnabled: boolean;
  startsAt: string | null;
  endsAt: string | null;
  sortOrder: number;
  status: AnnouncementStatus;
  createdAt: string;
  updatedAt: string;
}

export const listAnnouncements = async (): Promise<Announcement[]> => {
  const response = await api.get('/announcements');
  return response.data.data;
};

// No single-announcement GET on the server — the admin list is never large
// enough to matter, so the edit page just finds its row in it.
export const getAnnouncement = async (id: string): Promise<Announcement> => {
  const announcements = await listAnnouncements();
  const found = announcements.find((a) => a.id === id);
  if (!found) throw new Error('Announcement not found');
  return found;
};

export const getActiveAnnouncements = async (): Promise<Announcement[]> => {
  const response = await api.get('/announcements/active');
  return response.data.data;
};

// No single-announcement GET for vendors either — the active list is never
// large enough to matter, so the detail page just finds its row in it. Also
// means an announcement that expired between the list view and this fetch
// cleanly resolves to "not found" rather than a stale read.
export const getActiveAnnouncement = async (id: string): Promise<Announcement | null> => {
  const announcements = await getActiveAnnouncements();
  return announcements.find((a) => a.id === id) ?? null;
};

export interface AnnouncementInput {
  title: string;
  body: string;
  isEnabled: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  sortOrder?: number;
}

export const createAnnouncement = async (input: AnnouncementInput): Promise<Announcement> => {
  const response = await api.post('/announcements', input);
  return response.data.data;
};

export const updateAnnouncement = async (
  id: string,
  input: Partial<AnnouncementInput>,
): Promise<Announcement> => {
  const response = await api.patch(`/announcements/${id}`, input);
  return response.data.data;
};

export const deleteAnnouncement = async (id: string): Promise<void> => {
  await api.delete(`/announcements/${id}`);
};
