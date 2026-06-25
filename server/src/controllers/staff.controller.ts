import { Request, Response } from "express";
import {
  createStaff,
  listStaff,
  setStaffEnabled,
  updateStaff,
} from "../services/staff.service";

export async function listStaffController(req: Request, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });
    const staff = await listStaff({ id: req.user.id, roles: req.user.roles });
    return res.status(200).json({ success: true, data: staff });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load staff",
    });
  }
}

export async function createStaffController(req: Request, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });
    const staff = await createStaff({ id: req.user.id, roles: req.user.roles }, req.body);
    return res.status(201).json({ success: true, message: "Staff created", data: staff });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to create staff",
    });
  }
}

export async function updateStaffController(req: Request, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });
    const { id } = req.params;
    if (typeof id !== "string") {
      return res.status(400).json({ success: false, message: "Invalid staff id" });
    }
    const staff = await updateStaff({ id: req.user.id, roles: req.user.roles }, id, req.body);
    return res.status(200).json({ success: true, message: "Staff updated", data: staff });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to update staff",
    });
  }
}

export async function setStaffEnabledController(req: Request, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });
    const { id } = req.params;
    const { enabled } = req.body;
    if (typeof id !== "string") {
      return res.status(400).json({ success: false, message: "Invalid staff id" });
    }
    if (typeof enabled !== "boolean") {
      return res.status(400).json({ success: false, message: "enabled (boolean) is required" });
    }
    const staff = await setStaffEnabled({ id: req.user.id, roles: req.user.roles }, id, enabled);
    return res.status(200).json({ success: true, message: "Staff status updated", data: staff });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to update staff status",
    });
  }
}
