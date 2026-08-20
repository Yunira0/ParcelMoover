// The /uploads route lives on the API host, not under /api, so strip the
// suffix the axios base carries.
const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/api\/?$/, '');

/**
 * Browser URL for a stored document path. Windows-style separators and
 * absolute prefixes both show up in stored paths; everything after the
 * "uploads/" segment is what the route actually serves (and decrypts).
 */
export const toDocumentUrl = (path: string) =>
  `${API_BASE}/${path.replace(/\\/g, '/').replace(/^.*?(uploads\/)/, '$1')}`;
