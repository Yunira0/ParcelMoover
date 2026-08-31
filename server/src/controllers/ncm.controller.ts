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
          ? `Handed off ${results.length} parcel${results.length === 1 ? "" : "s"} to the courier partner`
          : `${results.length - failed.length} of ${results.length} parcels handed off; ${failed.length} failed`,
      data: results,
    });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Courier partner handoff failed",
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

export async function ncmMatchPreviewController(req: Request, res: Response) {
  try {
    const { destination, district, ncmBranch, locationId } = req.query as Record<string, string | undefined>;
    let dest: { name: string; district: string | null; ncm_branch?: string | null } | null = null;

    if (locationId) {
      const { default: prisma } = await import("../lib/prisma");
      const loc = await prisma.locations.findUnique({ where: { id: locationId } });
      if (!loc) return res.status(404).json({ success: false, message: `Location ${locationId} not found` });
      dest = { name: loc.name, district: loc.district, ncm_branch: (loc as any).ncm_branch ?? null };
    } else if (destination) {
      dest = { name: destination, district: district ?? null, ncm_branch: ncmBranch ?? null };
    } else {
      return res.status(400).json({
        success: false,
        message: "Provide ?locationId=<uuid> or ?destination=<name>&district=<district>&ncmBranch=<branch>",
      });
    }

    const { listNcmBranches, matchNcmBranch } = await import("../services/ncm.service");
    const branches = await listNcmBranches();
    const matched = matchNcmBranch(dest as any, branches);

    // Build per-tier debug info so ops can see why a village was skipped or misrouted
    const placeName = dest.name.includes(" - ") ? dest.name.slice(0, dest.name.indexOf(" - ")).trim() : dest.name.trim();
    const normalizeDistrict = (s: string) =>
      s.trim().toUpperCase().replace(/\s+DISTRICT\s*$/, "").replace(/\s+/g, " ").trim();
    const districtNorm = dest.district?.trim() ? normalizeDistrict(dest.district) : null;
    const byDistrict = districtNorm
      ? branches.filter((b) => {
          const bd = b.district?.trim();
          return bd ? normalizeDistrict(bd) === districtNorm : false;
        })
      : [];

    return res.status(200).json({
      success: true,
      data: {
        destination: dest,
        placeName,
        branchesChecked: branches.length,
        districtMatches: byDistrict.map((b) => ({ name: b.name, district: b.district })),
        matched: matched ? { name: matched.name, district: matched.district, covered_areas: matched.covered_areas } : null,
        hint: !matched
          ? byDistrict.length > 1
            ? `District '${dest.district}' has ${byDistrict.length} branches (${byDistrict.map((b) => b.name).join(", ")}) — ambiguous, no single match — parcel left as is.`
            : byDistrict.length === 0 && districtNorm
              ? `District '${dest.district}' has 0 branches in NCM's live list (${branches.length} total: ${branches.map((b) => b.name).join(", ")}). No match — parcel left as is.`
              : `No exact match — parcel left as is.`
          : byDistrict.length > 1
            ? `Matched via name/covered_areas despite ${byDistrict.length} branches sharing district '${dest.district}'.`
            : "Matched successfully",
      },
    });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Match preview failed",
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
