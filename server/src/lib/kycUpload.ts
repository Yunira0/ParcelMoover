import multer from "multer";
import path from "path";
import fs from "fs";
import { randomBytes } from "crypto";
import { safeUploadExtension } from "./uploadExtension";
import { AppError } from "../utils/AppError";

const UPLOAD_DIR = path.join(process.cwd(), "uploads", "kyc");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// HEIC/HEIF (iPhone camera default) is accepted here and converted to JPEG by
// secureUploadedFiles before it's ever stored.
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf", "image/heic", "image/heif"];
const MAX_SIZE_MB = 5;

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = safeUploadExtension(file.mimetype);
    cb(null, `${Date.now()}-${randomBytes(8).toString("hex")}${ext}`);
  },
});

export const kycUpload = multer({
  storage,
  limits: { fileSize: MAX_SIZE_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new AppError(400, "Only JPG, PNG, WebP, HEIC, and PDF files are allowed"));
    }
  },
}).fields([
  { name: "citizenshipDocFront", maxCount: 1 },
  { name: "citizenshipDocBack", maxCount: 1 },
  { name: "panVatDoc", maxCount: 1 },
  { name: "businessCertDoc", maxCount: 1 },
]);
