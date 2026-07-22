import { Request, Response } from "express";
import { getVendorSelfRates, getVendorSingleQuote } from "../../services/delivery-rate.service";
import { PublicQuoteQuery } from "../../validators/publicApi.schema";
import { actorFrom, sendError } from "./shared";

export async function publicGetRatesController(req: Request, res: Response) {
  try {
    if (!req.apiKey) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const data = await getVendorSelfRates(actorFrom(req));
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return sendError(res, error, "Failed to load rates");
  }
}

export async function publicGetRateQuoteController(req: Request, res: Response) {
  try {
    if (!req.apiKey) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const query = req.query as unknown as PublicQuoteQuery;
    const data = await getVendorSingleQuote(
      actorFrom(req),
      query.destinationLocationId,
      query.weightKg ?? 1,
      query.serviceType ?? "home_delivery",
    );

    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return sendError(res, error, "Failed to calculate quote");
  }
}
