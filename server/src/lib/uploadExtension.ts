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
};

export function safeUploadExtension(mimetype: string): string {
  return EXTENSION_BY_MIME_TYPE[mimetype] ?? "";
}
