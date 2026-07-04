import { Request, Response } from "express";
import prisma from "../lib/prisma";
import {
  getPricingSettings,
  updatePricingSettings,
  getVendorQuote,
  RATE_TYPES,
  RateType,
  VendorRateOverrides,
} from "../services/pricing.service";
import { isStaffActor, resolveOwnVendorId } from "../services/vendor-scope.service";

export async function getPricingSettingsController(_req: Request, res: Response) {
  try {
    const data = await getPricingSettings();
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load pricing settings",
    });
  }
}

export async function updatePricingSettingsController(req: Request, res: Response) {
  try {
    const data = await updatePricingSettings(req.body);
    return res.status(200).json({ success: true, message: "Pricing settings saved", data });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to save pricing settings",
    });
  }
}

// GET /api/pricing/quote — vendor-aware quote. Resolves the rate model from the
// vendor (the order form passes vendorId; vendor actors resolve to their own).
export async function getVendorQuoteController(req: Request, res: Response) {
  try {
    const { vendorId, destinationLocationId, weightKg } = req.query;
    if (typeof destinationLocationId !== "string") {
      return res.status(400).json({ success: false, message: "destinationLocationId is required" });
    }

    const RATE_SELECT = {
      rate_type: true,
      flat_inside_valley: true,
      flat_outside_valley: true,
      zone_major_cities: true,
      zone_urban_areas: true,
      zone_remote_areas: true,
    } as const;

    let vendor = null;
    // Vendor and vendor_staff actors always resolve to their own vendor —
    // a caller-supplied vendorId is only honored for staff (admin/super_admin),
    // otherwise a vendor_staff account could read another vendor's rate overrides.
    const ownVendorId = await resolveOwnVendorId(req.user!);

    if (ownVendorId) {
      vendor = await prisma.vendors.findFirst({
        where: { id: ownVendorId, deleted_at: null },
        select: RATE_SELECT,
      });
    } else if (isStaffActor(req.user!) && typeof vendorId === "string" && vendorId) {
      vendor = await prisma.vendors.findFirst({
        where: { id: vendorId, deleted_at: null },
        select: RATE_SELECT,
      });
    }

    const rateType = (vendor?.rate_type as RateType) ?? null;
    if (!rateType || !RATE_TYPES.includes(rateType)) {
      return res.status(400).json({ success: false, message: "Could not resolve vendor rate type" });
    }

    const overrides: VendorRateOverrides = {
      flatInsideValley: vendor!.flat_inside_valley === null ? null : Number(vendor!.flat_inside_valley),
      flatOutsideValley: vendor!.flat_outside_valley === null ? null : Number(vendor!.flat_outside_valley),
      zoneMajorCities: vendor!.zone_major_cities === null ? null : Number(vendor!.zone_major_cities),
      zoneUrbanAreas: vendor!.zone_urban_areas === null ? null : Number(vendor!.zone_urban_areas),
      zoneRemoteAreas: vendor!.zone_remote_areas === null ? null : Number(vendor!.zone_remote_areas),
    };

    const weight = weightKg !== undefined ? Number(weightKg) : 1;
    const quote = await getVendorQuote(rateType, destinationLocationId, weight, overrides);
    return res.status(200).json({ success: true, data: quote });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to get quote",
    });
  }
}
