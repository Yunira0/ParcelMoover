// iPhones save camera photos as HEIC by default, and no browser can render one
// in an <img> preview or upload it anywhere useful server-side - the server's
// own HEIC handling (server/src/lib/secureUploadedFiles.ts) has to reject it,
// because sharp's prebuilt binaries can't decode real (HEVC-encoded) HEIC,
// only the royalty-free AVIF variant of the same container format. Converting
// here, client-side, sidesteps that entirely: heic2any bundles its own WASM
// libheif build, unconstrained by the licensing restrictions on prebuilt
// native binaries.
const HEIC_MIME_TYPES = new Set(["image/heic", "image/heic-sequence", "image/heif", "image/heif-sequence"]);
const HEIC_EXTENSION_RE = /\.(heic|heif)$/i;

export function isHeicFile(file: File): boolean {
  // Some browsers/OSes (notably a fair few Android WebViews) leave `file.type`
  // empty for HEIC - the extension is the fallback signal in that case.
  return HEIC_MIME_TYPES.has(file.type) || HEIC_EXTENSION_RE.test(file.name);
}

/**
 * Converts a HEIC/HEIF file to JPEG in the browser. Returns the original file
 * untouched if it isn't HEIC, or if conversion fails for any reason - the
 * upload proceeds either way, and the server's own file-type check rejects a
 * genuinely bad file with a clear message rather than this silently blocking
 * the picker.
 */
export async function convertHeicFileIfNeeded(file: File): Promise<File> {
  if (!isHeicFile(file)) return file;

  try {
    const heic2any = (await import("heic2any")).default;
    const result = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.85 });
    const blob = Array.isArray(result) ? result[0]! : result;
    const name = file.name.replace(HEIC_EXTENSION_RE, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg", lastModified: file.lastModified });
  } catch (err) {
    console.error(`Failed to convert HEIC file "${file.name}", uploading as-is:`, err);
    return file;
  }
}
