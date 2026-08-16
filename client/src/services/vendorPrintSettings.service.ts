import api from '../utils/api';

// A vendor's own sticker/label print size. Self-service, unlike every other
// vendor-scoped setting in this app (rates, billing thresholds are all
// admin-set) - see printLabels.ts for how this is applied.

export interface LabelSize {
  widthMm: number | null;
  heightMm: number | null;
}

export const getMyLabelSize = async (): Promise<LabelSize> => {
  const response = await api.get('/vendor-settings/label-size');
  return response.data.data;
};

export const updateMyLabelSize = async (input: LabelSize): Promise<LabelSize> => {
  const response = await api.patch('/vendor-settings/label-size', input);
  return response.data.data;
};
