import { Router } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.middleware";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware";
import { csrfProtection } from "../middlewares/csrf.middleware";
import { createRedisRateLimitStore } from "../lib/rateLimitStore";
import { noticeImageUpload } from "../lib/noticeUpload";
import sharp from "sharp";
import fs from "fs/promises";
import path from "path";
import {
  getActiveNoticesController,
  dismissNoticeController,
  listNoticesController,
  getNoticeByIdController,
  createNoticeController,
  updateNoticeController,
  deleteNoticeController,
  hardDeleteNoticeController,
} from "../controllers/vendorNotice.controller";

const vendorNoticeRouter: Router = Router();

const vendorReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisRateLimitStore("vendor-notice-read"),
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? ""),
});

const vendorWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisRateLimitStore("vendor-notice-write"),
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? ""),
});

const adminWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisRateLimitStore("vendor-notice-admin"),
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? ""),
});

// --- Vendor-facing ---

// GET /api/vendor-notices/active — fetch undissmissed active notices for the logged-in vendor
vendorNoticeRouter.get(
  "/active",
  authMiddleware,
  authorizeRoles("vendor", "vendor_staff"),
  vendorReadLimiter,
  getActiveNoticesController,
);

// POST /api/vendor-notices/:id/dismiss — dismiss a notice
vendorNoticeRouter.post(
  "/:id/dismiss",
  authMiddleware,
  csrfProtection,
  authorizeRoles("vendor", "vendor_staff"),
  vendorWriteLimiter,
  dismissNoticeController,
);

// --- Admin-facing ---

// GET /api/vendor-notices — list all notices (admin)
vendorNoticeRouter.get(
  "/",
  authMiddleware,
  authorizeRoles("super_admin", "admin"),
  vendorReadLimiter,
  listNoticesController,
);

// GET /api/vendor-notices/:id — get single notice with targets
vendorNoticeRouter.get(
  "/:id",
  authMiddleware,
  authorizeRoles("super_admin", "admin"),
  vendorReadLimiter,
  getNoticeByIdController,
);

// POST /api/vendor-notices — create notice
vendorNoticeRouter.post(
  "/",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin"),
  adminWriteLimiter,
  createNoticeController,
);

// PUT /api/vendor-notices/:id — update notice
vendorNoticeRouter.put(
  "/:id",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin"),
  adminWriteLimiter,
  updateNoticeController,
);

// DELETE /api/vendor-notices/:id — soft-delete (deactivate)
vendorNoticeRouter.delete(
  "/:id",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin"),
  adminWriteLimiter,
  deleteNoticeController,
);

// POST /api/vendor-notices/:id/hard-delete — permanent delete
vendorNoticeRouter.post(
  "/:id/hard-delete",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin"),
  adminWriteLimiter,
  hardDeleteNoticeController,
);

// POST /api/vendor-notices/upload — upload and compress notice image
vendorNoticeRouter.post(
  "/upload",
  authMiddleware,
  csrfProtection,
  authorizeRoles("super_admin", "admin"),
  adminWriteLimiter,
  noticeImageUpload.single("image"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: "No image file provided" });
      }

      // Compress with Sharp - cropped (not just fit-inside) to a fixed 16:9
      // frame, so every banner displays identically regardless of the
      // source image's aspect ratio, instead of leaving letterbox gaps.
      // The suffix (not a bare extension swap) guarantees outputPath is
      // never equal to inputPath - a source already named *.webp would
      // otherwise collide, and sharp refuses to read/write the same file.
      const inputPath = req.file.path;
      const outputPath = inputPath.replace(/\.[^.]+$/, "-cropped.webp");

      await sharp(inputPath)
        .rotate()
        .resize(1280, 720, { fit: "cover", position: "attention" })
        .webp({ quality: 80 })
        .toFile(outputPath);

      // Remove original, keep compressed webp
      await fs.unlink(inputPath).catch(() => {});

      const imageUrl = `/uploads/notices/${path.basename(outputPath)}`;

      return res.status(200).json({ success: true, data: { imageUrl } });
    } catch (error: any) {
      console.error("[VendorNotice] Failed to process uploaded image:", error);
      // Clean up uploaded file on error
      if (req.file?.path) {
        await fs.unlink(req.file.path).catch(() => {});
      }
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to upload image",
      });
    }
  },
);

export default vendorNoticeRouter;
