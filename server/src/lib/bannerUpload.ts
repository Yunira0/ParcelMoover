import multer from "multer";
import path from "path";
import fs from "fs";
import { randomBytes } from "crypto";
import { safeUploadExtension } from "./uploadExtension";

// Admin-uploaded banner creatives shown to vendors. Same storage/encryption
// contract as billingUpload.ts's QR — secureUploadedFiles must run before the
// path is stored.
const UPLOAD_DIR = path.join(process.cwd(), "uploads", "banners");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE_MB = 5;

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = safeUploadExtension(file.mimetype);
    cb(null, `${Date.now()}-${randomBytes(8).toString("hex")}${ext}`);
  },
});

const bannerMulter = multer({
  storage,
  limits: { fileSize: MAX_SIZE_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPG, PNG, and WebP images are allowed"));
    }
  },
});

export const bannerImageUpload = bannerMulter.fields([{ name: "image", maxCount: 1 }]);
