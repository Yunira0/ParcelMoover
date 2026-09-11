// The saved file's extension must never come from the client-supplied
// originalname - that lets an attacker upload e.g. "evil.html" with a spoofed
// image Content-Type and have it stored (and later served statically) with an
// executable/renderable extension. Deriving the extension from the verified
// mimetype instead closes that off.
const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
  // Accepted on upload only - secureUploadedFiles converts every HEIC/HEIF
  // file to JPEG before it's ever encrypted and stored, so this extension
  // only ever names the transient pre-conversion file on disk.
  "image/heic": ".heic",
  "image/heif": ".heif",
};

export function safeUploadExtension(mimetype: string): string {
  return EXTENSION_BY_MIME_TYPE[mimetype] ?? "";
}

const MIME_TYPE_BY_EXTENSION: Record<string, string> = Object.fromEntries(
  Object.entries(EXTENSION_BY_MIME_TYPE).map(([mime, ext]) => [ext, mime]),
);

export function mimeTypeForExtension(ext: string): string {
  return MIME_TYPE_BY_EXTENSION[ext.toLowerCase()] ?? "application/octet-stream";
}
