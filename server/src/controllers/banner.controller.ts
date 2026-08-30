import { Request, Response } from "express";
import {
  listBanners,
  getBanner,
  createBanner,
  updateBanner,
  deleteBanner,
  getActiveBanners,
  BannerDisplayType,
} from "../services/banner.service";
import { flattenMulterFiles, secureUploadedFiles } from "../lib/secureUploadedFiles";
import { sendEncryptedFile } from "../lib/serveEncryptedDocument";

function fail(res: Response, error: any, fallback: string) {
  return res.status(error?.statusCode || 500).json({
    success: false,
    message: error?.message || fallback,
    ...(error?.code ? { code: error.code } : {}),
  });
}

const DISPLAY_TYPES: BannerDisplayType[] = ["modal", "permanent"];

// GET /api/banners — every banner, any status (admin list)
export async function listBannersController(_req: Request, res: Response) {
  try {
    const data = await listBanners();
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return fail(res, error, "Failed to load banners");
  }
}

// GET /api/banners/active — the one live modal + one live permanent banner
// a vendor should see right now.
export async function getActiveBannersController(_req: Request, res: Response) {
  try {
    const data = await getActiveBanners();
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return fail(res, error, "Failed to load active banners");
  }
}

// GET /api/banners/:id/image — the creative itself, decrypted on the way out.
export async function getBannerImageController(req: Request, res: Response) {
  try {
    const banner = await getBanner(req.params.id as string);
    await sendEncryptedFile(res, banner.imagePath);
  } catch (error: any) {
    return fail(res, error, "Failed to load banner image");
  }
}

// POST /api/banners — create (multipart: image required + fields)
export async function createBannerController(req: Request, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });

    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const image = files?.image?.[0];
    if (!image) return res.status(400).json({ success: false, message: "A banner image is required" });

    const { name, linkUrl, displayType, isEnabled, startsAt, endsAt, sortOrder } = req.body;
    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ success: false, message: "A banner name is required" });
    }
    if (displayType && !DISPLAY_TYPES.includes(displayType)) {
      return res.status(400).json({ success: false, message: "Invalid display type" });
    }

    await secureUploadedFiles(flattenMulterFiles(files));

    const data = await createBanner(
      {
        name,
        linkUrl: linkUrl || null,
        ...(displayType ? { displayType: displayType as BannerDisplayType } : {}),
        ...(isEnabled !== undefined ? { isEnabled: isEnabled === "true" || isEnabled === true } : {}),
        startsAt: startsAt || null,
        endsAt: endsAt || null,
        ...(sortOrder !== undefined ? { sortOrder: Number(sortOrder) } : {}),
      },
      `uploads/banners/${image.filename}`,
      req.user.id,
    );
    return res.status(201).json({ success: true, data });
  } catch (error: any) {
    return fail(res, error, "Failed to create banner");
  }
}

// PATCH /api/banners/:id — update fields, optionally replacing the image
export async function updateBannerController(req: Request, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });

    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const image = files?.image?.[0];
    if (image) await secureUploadedFiles(flattenMulterFiles(files));

    const { name, linkUrl, displayType, isEnabled, startsAt, endsAt, sortOrder } = req.body;
    if (displayType && !DISPLAY_TYPES.includes(displayType)) {
      return res.status(400).json({ success: false, message: "Invalid display type" });
    }

    const data = await updateBanner(
      req.params.id as string,
      {
        ...(name !== undefined ? { name } : {}),
        ...(linkUrl !== undefined ? { linkUrl: linkUrl || null } : {}),
        ...(displayType !== undefined ? { displayType: displayType as BannerDisplayType } : {}),
        ...(isEnabled !== undefined ? { isEnabled: isEnabled === "true" || isEnabled === true } : {}),
        ...(startsAt !== undefined ? { startsAt: startsAt || null } : {}),
        ...(endsAt !== undefined ? { endsAt: endsAt || null } : {}),
        ...(sortOrder !== undefined ? { sortOrder: Number(sortOrder) } : {}),
      },
      image ? `uploads/banners/${image.filename}` : undefined,
    );
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return fail(res, error, "Failed to update banner");
  }
}

// DELETE /api/banners/:id
export async function deleteBannerController(req: Request, res: Response) {
  try {
    await deleteBanner(req.params.id as string);
    return res.status(200).json({ success: true });
  } catch (error: any) {
    return fail(res, error, "Failed to delete banner");
  }
}
