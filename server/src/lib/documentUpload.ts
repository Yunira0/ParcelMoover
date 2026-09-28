import fs from "fs";
import { readFile, unlink, writeFile } from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";
import multer from "multer";
import { AppError } from "../utils/AppError";
import { encryptDocument } from "./documentEncryption";

// Office documents and spreadsheets (not images), e.g. a 3PL carrier's own
// settlement sheet. The file's extension decides what its bytes must be:
// browsers label the same file differently (a .csv often arrives as an Excel
// type on Windows), so the declared Content-Type is never trusted.

const UPLOAD_DIR = path.join(process.cwd(), "uploads", "settlements");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_SIZE_MB = 10;
const MAX_FILES = 5;

/** What file-type must detect for each extension; null = plain text with no signature. */
const EXPECTED_BY_EXTENSION: Record<string, string | null> = {
  ".pdf": "application/pdf",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  // Legacy Office files are all the same compound-file container.
  ".xls": "application/x-cfb",
  ".doc": "application/x-cfb",
  ".csv": null,
};

export const DOCUMENT_EXTENSIONS = Object.keys(EXPECTED_BY_EXTENSION);
const extensionOf = (name: string) => path.extname(name).toLowerCase();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${randomBytes(8).toString("hex")}${extensionOf(file.originalname)}`),
});

/** The `settlementFile` field on POST /finance/carrier-settlements/:id/documents. */
export const carrierSettlementFileUpload = multer({
  storage,
  limits: { fileSize: MAX_SIZE_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (extensionOf(file.originalname) in EXPECTED_BY_EXTENSION) cb(null, true);
    else cb(new AppError(400, "Only PDF, Excel (xlsx, xls), Word (docx, doc) and CSV files are allowed"));
  },
}).fields([{ name: "settlementFile", maxCount: MAX_FILES }]);

/** No NUL bytes and valid UTF-8: what a CSV actually is. */
function isPlainText(bytes: Buffer): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks each uploaded document's bytes against its extension, then encrypts
 * it at rest - the document counterpart of secureUploadedFiles. A file that
 * fails is deleted and the whole request is refused.
 */
export async function secureUploadedDocuments(files: Express.Multer.File[]): Promise<void> {
  const { fileTypeFromBuffer } = await import("file-type");
  for (const file of files) {
    const bytes = await readFile(file.path);
    const expected = EXPECTED_BY_EXTENSION[extensionOf(file.originalname)];
    const detected = await fileTypeFromBuffer(bytes);
    const valid = expected === null ? !detected && isPlainText(bytes) : detected?.mime === expected;
    if (!valid) {
      await unlink(file.path).catch(() => {});
      throw new AppError(400, `"${file.originalname}" is not a valid ${extensionOf(file.originalname).slice(1).toUpperCase()} file`);
    }
    await writeFile(file.path, encryptDocument(bytes));
  }
}
