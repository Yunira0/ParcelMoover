import multer from "multer";
import path from "path";
import fs from "fs";
import { randomBytes } from "crypto";
import { safeUploadExtension } from "./uploadExtension";

// Payment receipt + tax invoice captured when a settlement is paid out. Same
// storage/encryption contract as the billing and KYC uploads — see
// secureUploadedFiles, which every consumer of this must call before storing
// the path.
const UPLOAD_DIR = path.join(process.cwd(), "uploads", "settlements");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const MAX_SIZE_MB = 5;

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = safeUploadExtension(file.mimetype);
    cb(null, `${Date.now()}-${randomBytes(8).toString("hex")}${ext}`);
  },
});

// A statement can hold several receipts — one per instalment when a payout is
// paid in parts, plus extra shots of the same transfer (the slip and the ledger
// page). Capped per request so a runaway client can't fill the disk in one go;
// more can always be added in a follow-up request.
const MAX_FILES_PER_FIELD = 5;

/**
 * Payment evidence on POST /finance/settlements/:id/pay and
 * PATCH /finance/settlements/:id/documents. Both fields are optional — a cash
 * handover has neither. Non-multipart (JSON) requests pass straight through, so
 * existing callers that post no files still work.
 */
export const settlementDocsUpload = multer({
  storage,
  limits: { fileSize: MAX_SIZE_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPG, PNG, WebP, and PDF files are allowed"));
    }
  },
}).fields([
  { name: "paymentReceipt", maxCount: MAX_FILES_PER_FIELD },
  { name: "taxInvoice", maxCount: MAX_FILES_PER_FIELD },
]);
