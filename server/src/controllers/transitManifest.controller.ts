import { Request, Response } from "express";
import {
  addParcelsToTransitManifest,
  createTransitManifest,
  getTransitManifestById,
  listTransitManifests,
  receiveTransitManifestParcels,
} from "../services/transitManifest.service";
import {
  ListTransitManifestsParams,
  TransitManifestStatus,
} from "../types/transitManifest.type";

export async function listTransitManifestsController(req: Request, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });
    const { status, search, page, pageSize, sortDir } = req.query;

    const params: ListTransitManifestsParams = {};
    if (typeof status === "string") params.status = status as TransitManifestStatus;
    if (typeof search === "string") params.search = search;
    if (typeof page === "number") params.page = page;
    if (typeof pageSize === "number") params.pageSize = pageSize;
    if (sortDir === "asc" || sortDir === "desc") params.sortDir = sortDir;

    const { data, meta } = await listTransitManifests(
      { id: req.user.id, roles: req.user.roles },
      params,
    );
    return res.status(200).json({ success: true, data, meta });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load transit manifests",
    });
  }
}

export async function getTransitManifestController(req: Request, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await getTransitManifestById(
      { id: req.user.id, roles: req.user.roles },
      req.params.id as string,
    );
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load the transit manifest",
    });
  }
}

export async function createTransitManifestController(req: Request, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await createTransitManifest({ id: req.user.id, roles: req.user.roles }, req.body);
    return res.status(201).json({ success: true, message: "Transit manifest opened", data });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to open the transit manifest",
    });
  }
}

export async function addTransitManifestParcelsController(req: Request, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await addParcelsToTransitManifest(
      { id: req.user.id, roles: req.user.roles },
      req.params.id as string,
      req.body,
    );
    return res.status(200).json({
      success: true,
      message: `${data.updated} parcel${data.updated === 1 ? "" : "s"} dispatched`,
      data,
    });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Scan failed",
    });
  }
}

export async function receiveTransitManifestParcelsController(req: Request, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await receiveTransitManifestParcels(
      { id: req.user.id, roles: req.user.roles },
      req.params.id as string,
      req.body,
    );
    return res.status(200).json({
      success: true,
      message: `${data.updated} parcel${data.updated === 1 ? "" : "s"} received`,
      data,
    });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Receive failed",
    });
  }
}
