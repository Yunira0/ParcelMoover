import { Request, Response } from "express";
import { getSlaSettings, updateSlaSettings } from "../services/sla.service";

export async function getSlaSettingsController(_req: Request, res: Response) {
  try {
    const data = await getSlaSettings();
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load SLA settings",
    });
  }
}

export async function updateSlaSettingsController(req: Request, res: Response) {
  try {
    const data = await updateSlaSettings(req.body ?? {});
    return res.status(200).json({ success: true, message: "SLA settings saved", data });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to save SLA settings",
    });
  }
}
