import multer from "multer";
import path from "path";
import fs from "fs";
import { randomBytes } from "crypto";
import { safeUploadExtension } from "./uploadExtension";

// Payment proof screenshots (vendor side) and the office Fonepay QR (admin
// side). Same storage/encryption contract as the KYC uploads — see
// secureUploadedFiles, which every consumer of this must call before storing
// the path.
const UPLOAD_DIR = path.join(process.cwd(), "uploads", "billing");
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

const billingMulter = multer({
  storage,
  limits: { fileSize: MAX_SIZE_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPG, PNG, WebP, and PDF files are allowed"));
    }
  },
});

/** Vendor-submitted payment proof (screenshot of the Fonepay confirmation). */
export const paymentProofUpload = billingMulter.fields([{ name: "proof", maxCount: 1 }]);

/** Admin-uploaded static Fonepay QR shown to every vendor. */
export const paymentQrUpload = billingMulter.fields([{ name: "qr", maxCount: 1 }]);
