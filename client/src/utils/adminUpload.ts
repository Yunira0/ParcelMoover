// Admin onboarding is a staff-only workflow; these messages do not change
// vendor registration or the Partner API. Match registrationUpload's 5 MiB cap.
export const MAX_ADMIN_DOCUMENT_BYTES = 5 * 1024 * 1024;

export function formatAdminFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
  // Avoid calling a file just over the limit "5.0 MB" in its rejection message.
  return `${(Math.ceil(bytes / (1024 * 1024) * 10) / 10).toFixed(1)} MB`;
}

export function adminDocumentSizeError(file: Pick<File, 'name' | 'size'>): string | undefined {
  // The existing multipart parser rejects as soon as it reaches the cap.
  if (file.size < MAX_ADMIN_DOCUMENT_BYTES) return undefined;
  return `${file.name} is ${formatAdminFileSize(file.size)}. Maximum allowed is 5 MB. Compress the file or choose a smaller one.`;
}

interface SaveError {
  code?: string;
  response?: { status?: number; data?: { message?: unknown } };
}

export function adminSaveErrorMessage(error: unknown, fallback: string): string {
  const err = error as SaveError | null;
  const status = err?.response?.status;
  // Proxies often return HTML for 413, so handle the status before reading JSON.
  if (status === 413) {
    return 'The combined upload is too large. Compress one or more documents or remove an optional file, then try again. Each file must be 5 MB or smaller.';
  }
  if (err?.code === 'ECONNABORTED' || err?.code === 'ETIMEDOUT' || status === 408 || status === 504) {
    return 'The request timed out. Your form entries are still here. Check the admin list before retrying, as the request may have completed.';
  }
  if (err?.code === 'ERR_NETWORK') {
    return 'The connection failed. Your form entries are still here. Check your connection and the admin list before retrying.';
  }
  const message = err?.response?.data?.message;
  if (typeof message === 'string' && message.trim()) return message;
  if (status === 502 || status === 503) {
    return 'The server is temporarily unavailable. Your form entries are still here. Please try again later.';
  }
  return fallback;
}
