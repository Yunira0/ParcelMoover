import { Request, Response } from "express";
import {
  getDeliveryQuote,
  listDeliveryRates,
  setDeliveryRateActive,
  upsertDeliveryRate,
} from "../services/delivery-rate.service";

export async function listDeliveryRatesController(req: Request, res: Response) {
  try {
    const rates = await listDeliveryRates();
    return res.status(200).json({ success: true, data: rates });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load delivery rates",
    });
  }
}

export async function upsertDeliveryRateController(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { originLocationId, destinationLocationId, baseCharge, extraWeightPercent, freeWeightKg } = req.body;

    if (typeof originLocationId !== "string" || typeof destinationLocationId !== "string") {
      return res.status(400).json({
        success: false,
        message: "originLocationId and destinationLocationId are required",
      });
    }
    if (typeof baseCharge !== "number" || Number.isNaN(baseCharge)) {
      return res.status(400).json({ success: false, message: "baseCharge must be a number" });
    }

    const rate = await upsertDeliveryRate(
      { id: req.user.id, roles: req.user.roles },
      { originLocationId, destinationLocationId, baseCharge, extraWeightPercent, freeWeightKg },
    );

    return res.status(200).json({
      success: true,
      message: "Delivery rate saved",
      data: rate,
    });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to save delivery rate",
    });
  }
}

export async function setDeliveryRateActiveController(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { isActive } = req.body;
    if (typeof id !== "string" || typeof isActive !== "boolean") {
      return res.status(400).json({ success: false, message: "isActive (boolean) is required" });
    }

    const rate = await setDeliveryRateActive(id, isActive);
    return res.status(200).json({ success: true, data: rate });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to update delivery rate",
    });
  }
}

export async function getDeliveryQuoteController(req: Request, res: Response) {
  try {
    const { originLocationId, destinationLocationId, weightKg } = req.query;

    if (typeof originLocationId !== "string" || typeof destinationLocationId !== "string") {
      return res.status(400).json({
        success: false,
        message: "originLocationId and destinationLocationId are required",
      });
    }

    const weight = weightKg !== undefined ? Number(weightKg) : 1;
    if (Number.isNaN(weight) || weight <= 0) {
      return res.status(400).json({ success: false, message: "weightKg must be a positive number" });
    }

    const quote = await getDeliveryQuote(originLocationId, destinationLocationId, weight);
    return res.status(200).json({ success: true, data: quote });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to get delivery quote",
    });
  }
}
