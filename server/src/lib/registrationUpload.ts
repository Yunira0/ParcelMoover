import multer from "multer";
import path from "path";
import fs from "fs";
import { randomBytes } from "crypto";
import { safeUploadExtension } from "./uploadExtension";
import { AppError } from "../utils/AppError";
import type { RequestHandler } from "express";

const UPLOAD_DIR = path.join(process.cwd(), "uploads", "registration");
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

// Union of all document field names across admin / rider / vendor registration.
const uploadDocuments = multer({
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
  { name: "idDocument", maxCount: 1 },
  { name: "citizenshipDoc", maxCount: 1 },
  { name: "panDoc", maxCount: 1 },
  { name: "panVatDoc", maxCount: 1 },
  { name: "experienceLetterDoc", maxCount: 1 },
  { name: "licenceDoc", maxCount: 1 },
  { name: "bluebookDoc", maxCount: 1 },
  { name: "businessCertDoc", maxCount: 1 },
]);

// Admin account creation is staff-only and has no Partner API equivalent.
// Keep the existing vendor/rider error handling unchanged.
export const registrationUpload: RequestHandler = (req, res, next) => {
  uploadDocuments(req, res, (error) => {
    const isAdminUpload = req.params.type === "admin" || req.body?.type === "admin";
    if (isAdminUpload && error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      const field = error.field;
      const labels: Record<string, string> = {
        citizenshipDoc: "Citizenship document",
        idDocument: "National ID document",
        panDoc: "PAN document",
        experienceLetterDoc: "Experience letter",
      };
      const message = `${(field && labels[field]) || "Document"} exceeds the ${MAX_SIZE_MB} MB limit. Compress the file or choose a smaller one.`;
      res.status(400).json({
        success: false,
        message,
        code: "FILE_TOO_LARGE",
        ...(field ? { errors: [{ field, message }] } : {}),
      });
      return;
    }
    next(error);
  });
};
