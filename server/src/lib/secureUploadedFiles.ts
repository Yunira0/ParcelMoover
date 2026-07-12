import { readFile, unlink, writeFile } from "fs/promises";
import { AppError } from "../utils/AppError";
import { encryptDocument } from "./documentEncryption";

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

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

    await writeFile(file.path, encryptDocument(plaintext));
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
