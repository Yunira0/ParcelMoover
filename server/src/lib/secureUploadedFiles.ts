import { readFile, unlink, writeFile } from "fs/promises";
import path from "path";
import { AppError } from "../utils/AppError";
import { encryptDocument } from "./documentEncryption";

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

// Uploaded document photos are often multi-MB camera shots. Anything above
// this size gets recompressed to a bounded JPEG before encryption so the
// uploads volume doesn't fill with needlessly huge files. KYC/registration
// docs only need to be readable by a human reviewer, not print-quality.
const COMPRESS_THRESHOLD_BYTES = 300 * 1024;
const COMPRESSIBLE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_DIMENSION_PX = 1600;
const JPEG_QUALITY = 72;

// Returns the (possibly compressed) bytes to store, updating the multer file
// record in place when the compression converts the format — callers read
// file.filename AFTER this runs, so the stored DB path stays correct.
async function compressImageIfLarge(
  file: Express.Multer.File,
  plaintext: Buffer,
): Promise<Buffer> {
  if (!COMPRESSIBLE_IMAGE_TYPES.has(file.mimetype) || plaintext.length <= COMPRESS_THRESHOLD_BYTES) {
    return plaintext;
  }

  try {
    const sharp = (await import("sharp")).default;
    const compressed = await sharp(plaintext)
      // Bake in the EXIF orientation before metadata is stripped, or phone
      // photos would display sideways.
      .rotate()
      .resize(MAX_DIMENSION_PX, MAX_DIMENSION_PX, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer();

    if (compressed.length >= plaintext.length) return plaintext;

    // Output is JPEG regardless of input format; the file must move to a .jpg
    // name because the serving Content-Type is derived from the extension.
    const jpgPath = file.path.replace(/\.[^.]+$/, ".jpg");
    if (jpgPath !== file.path) {
      await unlink(file.path).catch(() => {});
      file.path = jpgPath;
      file.filename = path.basename(jpgPath);
    }
    file.mimetype = "image/jpeg";
    file.size = compressed.length;
    return compressed;
  } catch (err) {
    // A failed recompression must never block an otherwise valid upload —
    // store the original bytes instead.
    console.error(`[uploads] Failed to compress "${file.originalname}", storing original:`, err);
    return plaintext;
  }
}

// Multer's fileFilter only checks the client-supplied Content-Type header,
// which is trivial to spoof (e.g. renaming a script to citizenship.jpg with a
// fake image/jpeg header). This re-checks the actual file bytes via magic-byte
// sniffing after upload, then encrypts the file at rest. Runs after multer has
// already written the plaintext to disk with a randomized name/extension.
export async function secureUploadedFiles(files: Express.Multer.File[]): Promise<void> {
  const { fileTypeFromBuffer } = await import("file-type");

  for (const file of files) {
    const plaintext = await readFile(file.path);
    const detected = await fileTypeFromBuffer(plaintext);

    // No detectable signature, or the signature doesn't match what the client
    // declared (and multer already filtered on) — treat as untrusted rather
    // than falling back to the client-supplied Content-Type.
    if (!detected || detected.mime !== file.mimetype || !ALLOWED_MIME_TYPES.has(detected.mime)) {
      await unlink(file.path).catch(() => {});
      throw new AppError(400, `"${file.originalname}" is not a valid ${describeExpected(file.mimetype)} file`);
    }

    const output = await compressImageIfLarge(file, plaintext);
    await writeFile(file.path, encryptDocument(output));
  }
}

function describeExpected(mimetype: string): string {
  switch (mimetype) {
    case "image/jpeg":
      return "JPEG";
    case "image/png":
      return "PNG";
    case "image/webp":
      return "WebP";
    case "application/pdf":
      return "PDF";
    default:
      return "supported";
  }
}

export function flattenMulterFiles(
  files: Record<string, Express.Multer.File[]> | undefined,
): Express.Multer.File[] {
  if (!files) return [];
  return Object.values(files).flat();
}
