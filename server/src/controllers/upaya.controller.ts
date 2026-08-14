import { Request, Response } from "express";
import { timingSafeEqual, createHash } from "crypto";
import {
  getUpayaInfoForParcel,
  handoffParcelsToUpaya,
  listUpayaDeliveryAreas,
  listUpayaLocations,
  processUpayaWebhook,
  reconcileUpayaStatuses,
} from "../services/upaya.service";

export async function listUpayaLocationsController(_req: Request, res: Response) {
  try {
    const locations = await listUpayaLocations();
    return res.status(200).json({ success: true, data: locations });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load Upaya locations",
    });
  }
}

export async function upayaHandoffController(req: Request, res: Response) {
  try {
    const { parcelIds, serviceTypeId, orderType } = req.body;
    const results = await handoffParcelsToUpaya(
      { id: req.user!.id, roles: req.user!.roles ?? [] },
      parcelIds,
      serviceTypeId,
      orderType,
    );
    const failed = results.filter((r) => !r.success);
    return res.status(200).json({
      success: failed.length === 0,
      message:
        failed.length === 0
          ? `Handed off ${results.length} parcel${results.length === 1 ? "" : "s"} to Upaya`
          : `${results.length - failed.length} of ${results.length} parcels handed off; ${failed.length} failed`,
      data: results,
    });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Upaya handoff failed",
    });
  }
}

export async function getUpayaParcelInfoController(req: Request, res: Response) {
  try {
    const info = await getUpayaInfoForParcel(req.params.parcelId as string);
    return res.status(200).json({ success: true, data: info });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load Upaya info",
    });
  }
}

export async function upayaReconcileController(_req: Request, res: Response) {
  try {
    const result = await reconcileUpayaStatuses();
    return res.status(200).json({
      success: true,
      message: `Checked ${result.checked} in-flight Upaya order${result.checked === 1 ? "" : "s"}, applied ${result.applied} update${result.applied === 1 ? "" : "s"}`,
      data: result,
    });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Upaya reconciliation failed",
    });
  }
}

// ── Delivery areas (live, cached from Upaya's own network) ──────────────────

export async function listUpayaDeliveryAreasController(_req: Request, res: Response) {
  try {
    const areas = await listUpayaDeliveryAreas();
    return res.status(200).json({ success: true, data: areas });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load Upaya delivery areas",
    });
  }
}

// ── Webhook ───────────────────────────────────────────────────────────────────

// Hash both sides before comparing so timingSafeEqual gets equal-length
// buffers (it throws on length mismatch, which would itself leak length).
function secretMatches(candidate: string, secret: string): boolean {
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

/**
 * Public receiver for Upaya's order_status/comment webhooks. Upaya sends no
 * signature — the secret path segment is the only authentication, so it's
 * compared in constant time. Acks immediately (per their "return HTTP 200 OK
 * for successful processing" expectation) and processes on the next tick.
 */
export async function upayaWebhookController(req: Request, res: Response) {
  const secret = process.env.UPAYA_WEBHOOK_SECRET;
  if (!secret || !secretMatches(req.params.secret as string, secret)) {
    return res.status(404).json({ success: false, message: "Not found" });
  }

  const payload = req.body;
  res.status(200).json({ status: "received" });

  if (payload && typeof payload === "object") {
    setImmediate(() => {
      processUpayaWebhook(payload).catch((error) => {
        console.error("[Upaya] webhook processing error:", error);
      });
    });
  }
  return;
}
