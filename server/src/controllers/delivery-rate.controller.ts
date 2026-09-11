import { Request, Response } from "express";
import {
  bulkImportDeliveryRates,
  deleteDeliveryRate,
  getDeliveryQuote,
  getReturnRouteQuote,
  getVendorSelfRates,
  listDeliveryRates,
  setDeliveryRateActive,
  upsertDeliveryRate,
} from "../services/delivery-rate.service";

export async function listDeliveryRatesController(req: Request, res: Response) {
  try {
    const rates = await listDeliveryRates({ id: req.user!.id, roles: req.user!.roles });
    return res.status(200).json({ success: true, data: rates });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load delivery rates",
    });
  }
}

// The rates that apply to the requesting vendor, derived from their own rate
// model (flat / zone / per-destination) rather than the admin route table.
export async function getMyDeliveryRatesController(req: Request, res: Response) {
  try {
    const actor = { id: req.user!.id, roles: req.user!.roles };
    const data = await getVendorSelfRates(actor);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load your delivery rates",
    });
  }
}

export async function upsertDeliveryRateController(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const {
      originLocationId,
      destinationLocationId,
      baseCharge,
      branchBaseCharge,
      returnPercent,
      branchReturnPercent,
      extraWeightPercent,
      freeWeightKg,
    } = req.body;

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
      {
        originLocationId,
        destinationLocationId,
        baseCharge,
        branchBaseCharge,
        returnPercent,
        branchReturnPercent,
        extraWeightPercent,
        freeWeightKg,
      },
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

export async function bulkImportDeliveryRatesController(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const results = await bulkImportDeliveryRates(
      { id: req.user.id, roles: req.user.roles },
      req.body.rows,
    );

    const imported = results.filter((r) => !r.error).length;
    const failed = results.length - imported;

    return res.status(200).json({
      success: true,
      message: `${imported} rate(s) imported, ${failed} failed`,
      data: results,
    });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to import delivery rates",
    });
  }
}

export async function setDeliveryRateActiveController(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { id } = req.params;
    const { isActive } = req.body;
    if (typeof id !== "string" || typeof isActive !== "boolean") {
      return res.status(400).json({ success: false, message: "isActive (boolean) is required" });
    }

    const rate = await setDeliveryRateActive({ id: req.user.id, roles: req.user.roles }, id, isActive);
    return res.status(200).json({ success: true, data: rate });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to update delivery rate",
    });
  }
}

export async function deleteDeliveryRateController(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { id } = req.params;
    if (typeof id !== "string") {
      return res.status(400).json({ success: false, message: "id is required" });
    }

    await deleteDeliveryRate({ id: req.user.id, roles: req.user.roles }, id);
    return res.status(200).json({ success: true, message: "Delivery rate deleted" });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to delete delivery rate",
    });
  }
}

export async function getDeliveryQuoteController(req: Request, res: Response) {
  try {
    const { originLocationId, destinationLocationId, weightKg, serviceType, isReturn } = req.query;

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

    const service = serviceType === "branch_delivery" ? "branch_delivery" : "home_delivery";
    const quote =
      isReturn === "true"
        ? await getReturnRouteQuote(originLocationId, destinationLocationId, weight, service)
        : await getDeliveryQuote(originLocationId, destinationLocationId, weight, service);
    return res.status(200).json({ success: true, data: quote });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to get delivery quote",
    });
  }
}
