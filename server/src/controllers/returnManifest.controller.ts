import { Request, Response } from "express";
import {
  addParcelsToManifest,
  createReturnManifest,
  getOpenManifestForVendor,
  getReturnManifestById,
  listReturnManifests,
  receiveReturnManifest,
  removeParcelFromManifest,
  sendReturnManifest,
} from "../services/returnManifest.service";
import {
  ListReturnManifestsParams,
  ReturnManifestStatus,
} from "../types/returnManifest.type";

export async function listReturnManifestsController(req: Request, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });
    const { status, vendorId, search, page, pageSize, sortDir } = req.query;

    const params: ListReturnManifestsParams = {};
    if (typeof status === "string") params.status = status as ReturnManifestStatus;
    if (typeof vendorId === "string") params.vendorId = vendorId;
    if (typeof search === "string") params.search = search;
    if (typeof page === "number") params.page = page;
    if (typeof pageSize === "number") params.pageSize = pageSize;
    if (sortDir === "asc" || sortDir === "desc") params.sortDir = sortDir;

    const { data, meta } = await listReturnManifests(
      { id: req.user.id, roles: req.user.roles },
      params,
    );
    return res.status(200).json({ success: true, data, meta });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load return manifests",
    });
  }
}

export async function getOpenReturnManifestController(req: Request, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await getOpenManifestForVendor(req.query.vendorId as string);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load the vendor's open return manifest",
    });
  }
}

export async function getReturnManifestController(req: Request, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await getReturnManifestById(
      { id: req.user.id, roles: req.user.roles },
      req.params.id as string,
    );
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load the return manifest",
    });
  }
}

export async function createReturnManifestController(req: Request, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await createReturnManifest({ id: req.user.id, roles: req.user.roles }, req.body);
    return res.status(201).json({ success: true, message: "Return manifest opened", data });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to open the return manifest",
    });
  }
}

export async function addManifestParcelsController(req: Request, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await addParcelsToManifest(
      { id: req.user.id, roles: req.user.roles },
      req.params.id as string,
      req.body,
    );
    return res.status(200).json({
      success: true,
      message: `${data.added} parcel${data.added === 1 ? "" : "s"} added to the manifest`,
      data,
    });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to add parcels to the return manifest",
    });
  }
}

export async function removeManifestParcelController(req: Request, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await removeParcelFromManifest(
      { id: req.user.id, roles: req.user.roles },
      req.params.id as string,
      req.params.parcelId as string,
    );
    return res.status(200).json({ success: true, message: "Order removed from the manifest", data });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to remove the order from the return manifest",
    });
  }
}

export async function sendReturnManifestController(req: Request, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await sendReturnManifest(
      { id: req.user.id, roles: req.user.roles },
      req.params.id as string,
      req.body,
    );
    return res.status(200).json({ success: true, message: "Return manifest sent to the vendor", data });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to send the return manifest",
    });
  }
}

export async function receiveReturnManifestController(req: Request, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await receiveReturnManifest(
      { id: req.user.id, roles: req.user.roles },
      req.params.id as string,
      req.body,
    );
    return res.status(200).json({ success: true, message: "Return manifest marked received", data });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to mark the return manifest received",
    });
  }
}
