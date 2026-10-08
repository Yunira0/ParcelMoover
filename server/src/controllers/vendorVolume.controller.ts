import { Request, Response } from "express";
import { getVendorVolumeSettings, updateVendorVolumeSettings } from "../services/vendorVolume.service";

export async function getVendorVolumeSettingsController(_req: Request, res: Response) {
  try {
    const data = await getVendorVolumeSettings();
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load vendor volume settings",
    });
  }
}

export async function updateVendorVolumeSettingsController(req: Request, res: Response) {
  try {
    const data = await updateVendorVolumeSettings(Number(req.body?.highVolumeDailyParcels));
    return res.status(200).json({ success: true, message: "Vendor volume settings saved", data });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to save vendor volume settings",
    });
  }
}
