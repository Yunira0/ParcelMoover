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

/**
 * Payment evidence on POST /finance/settlements/:id/pay. Both fields are
 * optional — a cash handover has neither. Non-multipart (JSON) requests pass
 * straight through, so existing callers that post no files still work.
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
  { name: "paymentReceipt", maxCount: 1 },
  { name: "taxInvoice", maxCount: 1 },
]);
