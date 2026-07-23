import { Request, Response } from "express";
import { timingSafeEqual, createHash } from "crypto";
import {
  flushPendingNcmComments,
  getNcmInfoForParcel,
  handoffParcelsToNcm,
  listNcmBranches,
  markNcmOrderForReturn,
  processNcmWebhook,
  reconcileNcmStatuses,
  registerNcmWebhook,
  syncNcmCommentsToParcels,
} from "../services/ncm.service";

export async function listNcmBranchesController(_req: Request, res: Response) {
  try {
    const branches = await listNcmBranches();
    return res.status(200).json({ success: true, data: branches });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load NCM branches",
    });
  }
}

export async function ncmHandoffController(req: Request, res: Response) {
  try {
    const { parcelIds, deliveryType } = req.body;
    const results = await handoffParcelsToNcm(
      { id: req.user!.id, roles: req.user!.roles ?? [] },
      parcelIds,
      deliveryType,
    );
    const failed = results.filter((r) => !r.success);
    return res.status(200).json({
      success: failed.length === 0,
      message:
        failed.length === 0
          ? `Handed off ${results.length} parcel${results.length === 1 ? "" : "s"} to NCM`
          : `${results.length - failed.length} of ${results.length} parcels handed off; ${failed.length} failed`,
      data: results,
    });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "NCM handoff failed",
    });
  }
}

export async function getNcmParcelInfoController(req: Request, res: Response) {
  try {
    const info = await getNcmInfoForParcel(req.params.parcelId as string);
    return res.status(200).json({ success: true, data: info });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load NCM info",
    });
  }
}

export async function markNcmReturnController(req: Request, res: Response) {
  try {
    await markNcmOrderForReturn(
      { id: req.user!.id, roles: req.user!.roles ?? [] },
      req.params.parcelId as string,
      req.body.comment,
    );
    return res.status(200).json({ success: true, message: "Parcel marked for return via NCM" });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to mark parcel for NCM return",
    });
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function ncmReconcileController(_req: Request, res: Response) {
  try {
    const result = await reconcileNcmStatuses();
    // Spaced out, not back-to-back: firing all three steps at once is itself
    // enough to trip NCM's demo-host per-minute throttle.
    await sleep(1000);
    const comments = await flushPendingNcmComments();
    await sleep(1000);
    const inbound = await syncNcmCommentsToParcels();
    return res.status(200).json({
      success: true,
      message:
        `Checked ${result.checked} in-flight NCM order${result.checked === 1 ? "" : "s"}, applied ${result.applied} update${result.applied === 1 ? "" : "s"}; ` +
        `delivered ${comments.delivered}/${comments.attempted} queued comment${comments.attempted === 1 ? "" : "s"}; ` +
        `ingested ${inbound.ingested} NCM comment${inbound.ingested === 1 ? "" : "s"}`,
      data: { ...result, comments, inbound },
    });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "NCM reconciliation failed",
    });
  }
}

export async function registerNcmWebhookController(req: Request, res: Response) {
  try {
    const result = await registerNcmWebhook(req.body.publicBaseUrl);
    return res.status(200).json({
      success: true,
      message: `Webhook registered with NCM: ${result.url}`,
      data: result,
    });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to register NCM webhook",
    });
  }
}

// Hash both sides before comparing so timingSafeEqual gets equal-length
// buffers (it throws on length mismatch, which would itself leak length).
function secretMatches(candidate: string, secret: string): boolean {
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

/**
 * Public receiver for NCM status webhooks. NCM sends no signature — the
 * secret path segment is the only authentication, so it's compared in
 * constant time. NCM expects a 2xx within 10s and never retries, so we ack
 * immediately and process on the next tick.
 */
export async function ncmWebhookController(req: Request, res: Response) {
  const secret = process.env.NCM_WEBHOOK_SECRET;
  if (!secret || !secretMatches(req.params.secret as string, secret)) {
    return res.status(404).json({ success: false, message: "Not found" });
  }

  const payload = req.body;
  res.status(200).json({ status: "received" });

  if (payload && typeof payload === "object") {
    setImmediate(() => {
      processNcmWebhook(payload).catch((error) => {
        console.error("[NCM] webhook processing error:", error);
      });
    });
  }
  return;
}
