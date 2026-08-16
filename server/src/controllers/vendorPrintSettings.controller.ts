import { Request, Response } from "express";
import { getVendorLabelSize, updateVendorLabelSize } from "../services/vendorPrintSettings.service";
import { resolveOwnVendorId } from "../services/vendor-scope.service";

function fail(res: Response, error: any, fallback: string) {
  return res.status(error?.statusCode || 500).json({
    success: false,
    message: error?.message || fallback,
    ...(error?.code ? { code: error.code } : {}),
  });
}

// GET /api/vendor-settings/label-size — the caller's own sticker size override.
export async function getLabelSizeController(req: Request, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });

    const vendorId = await resolveOwnVendorId({ id: req.user.id, roles: req.user.roles });
    if (!vendorId) return res.status(403).json({ success: false, message: "No vendor account for this user" });

    const data = await getVendorLabelSize(vendorId);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return fail(res, error, "Failed to load label size");
  }
}

// PATCH /api/vendor-settings/label-size — vendor sets (or clears) their own
// sticker size. Self-service, unlike every other vendor override in the app.
export async function updateLabelSizeController(req: Request, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });

    const vendorId = await resolveOwnVendorId({ id: req.user.id, roles: req.user.roles });
    if (!vendorId) return res.status(403).json({ success: false, message: "No vendor account for this user" });

    const widthMm = req.body.widthMm === null || req.body.widthMm === undefined ? null : Number(req.body.widthMm);
    const heightMm = req.body.heightMm === null || req.body.heightMm === undefined ? null : Number(req.body.heightMm);

    const data = await updateVendorLabelSize(vendorId, { widthMm, heightMm });
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return fail(res, error, "Failed to update label size");
  }
}
