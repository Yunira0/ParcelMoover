import { Request, Response } from "express";
import {
  createLocation,
  listManagedLocations,
  updateLocation,
} from "../services/location.service";

export async function listManagedLocationsController(_req: Request, res: Response) {
  try {
    const data = await listManagedLocations();
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load locations",
    });
  }
}

export async function createLocationController(req: Request, res: Response) {
  try {
    const { name } = req.body;
    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ success: false, message: "name is required" });
    }
    const location = await createLocation(req.body);
    return res.status(201).json({ success: true, message: "Location created", data: location });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to create location",
    });
  }
}

export async function updateLocationController(req: Request, res: Response) {
  try {
    const { id } = req.params;
    if (typeof id !== "string") {
      return res.status(400).json({ success: false, message: "id is required" });
    }
    const location = await updateLocation(id, req.body);
    return res.status(200).json({ success: true, message: "Location updated", data: location });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to update location",
    });
  }
}
