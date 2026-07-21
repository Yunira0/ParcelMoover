import { Request, Response } from "express";
import {
  getActiveNoticesForVendor,
  dismissNotice,
  listNotices,
  getNoticeById,
  createNotice,
  updateNotice,
  deleteNotice,
  hardDeleteNotice,
} from "../services/vendorNotice.service";

function getParamId(req: Request): string {
  return String(req.params.id);
}

// --- Vendor-facing ---

export async function getActiveNoticesController(req: Request, res: Response) {
  try {
    const data = await getActiveNoticesForVendor(req.user!);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load notices",
    });
  }
}

export async function dismissNoticeController(req: Request, res: Response) {
  try {
    await dismissNotice(getParamId(req), req.user!);
    return res.status(200).json({ success: true, message: "Notice dismissed" });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to dismiss notice",
    });
  }
}

// --- Admin-facing ---

export async function listNoticesController(_req: Request, res: Response) {
  try {
    const data = await listNotices();
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load notices",
    });
  }
}

export async function getNoticeByIdController(req: Request, res: Response) {
  try {
    const data = await getNoticeById(getParamId(req));
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load notice",
    });
  }
}

export async function createNoticeController(req: Request, res: Response) {
  try {
    const { title, imageUrl, isDismissable, target, targetVendorIds } = req.body;
    if (!title?.trim()) {
      return res.status(400).json({ success: false, message: "Title is required" });
    }
    if (!imageUrl?.trim()) {
      return res.status(400).json({ success: false, message: "Banner image is required" });
    }

    const data = await createNotice(
      {
        title: title.trim(),
        imageUrl: imageUrl.trim(),
        isDismissable,
        target,
        targetVendorIds,
      },
      req.user!.id,
    );
    return res.status(201).json({ success: true, data });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to create notice",
    });
  }
}

export async function updateNoticeController(req: Request, res: Response) {
  try {
    const { title, imageUrl, isActive, isDismissable, target, targetVendorIds } = req.body;
    if (imageUrl !== undefined && !imageUrl?.trim()) {
      return res.status(400).json({ success: false, message: "Banner image is required" });
    }
    const data = await updateNotice(getParamId(req), {
      ...(title !== undefined && { title: title?.trim() }),
      ...(imageUrl !== undefined && { imageUrl: imageUrl.trim() }),
      ...(isActive !== undefined && { isActive }),
      ...(isDismissable !== undefined && { isDismissable }),
      ...(target !== undefined && { target }),
      ...(targetVendorIds !== undefined && { targetVendorIds }),
    });
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to update notice",
    });
  }
}

export async function deleteNoticeController(req: Request, res: Response) {
  try {
    await deleteNotice(getParamId(req));
    return res.status(200).json({ success: true, message: "Notice deactivated" });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to delete notice",
    });
  }
}

export async function hardDeleteNoticeController(req: Request, res: Response) {
  try {
    await hardDeleteNotice(getParamId(req));
    return res.status(200).json({ success: true, message: "Notice permanently deleted" });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to delete notice",
    });
  }
}
