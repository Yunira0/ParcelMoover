import multer from "multer";
import path from "path";
import fs from "fs";
import { randomBytes } from "crypto";
import { safeUploadExtension } from "./uploadExtension";

const UPLOAD_DIR = path.join(process.cwd(), "uploads", "registration");
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

// Union of all document field names across admin / rider / vendor registration.
export const registrationUpload = multer({
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
  { name: "idDocument", maxCount: 1 },
  { name: "citizenshipDoc", maxCount: 1 },
  { name: "panDoc", maxCount: 1 },
  { name: "panVatDoc", maxCount: 1 },
  { name: "experienceLetterDoc", maxCount: 1 },
  { name: "licenceDoc", maxCount: 1 },
  { name: "bluebookDoc", maxCount: 1 },
  { name: "businessCertDoc", maxCount: 1 },
]);
