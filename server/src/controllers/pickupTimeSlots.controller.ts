import { Request, Response } from "express";
import {
  listActivePickupTimeSlots,
  listAllPickupTimeSlots,
  createPickupTimeSlot,
  updatePickupTimeSlot,
  deletePickupTimeSlot,
} from "../services/pickupTimeSlots.service";

export async function getActivePickupTimeSlotsController(_req: Request, res: Response) {
  try {
    const data = await listActivePickupTimeSlots();
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load pickup time slots",
    });
  }
}

export async function getAllPickupTimeSlotsController(_req: Request, res: Response) {
  try {
    const data = await listAllPickupTimeSlots();
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load pickup time slots",
    });
  }
}

export async function createPickupTimeSlotController(req: Request, res: Response) {
  try {
    const { startMinutes, endMinutes } = req.body ?? {};
    const data = await createPickupTimeSlot({
      startMinutes: Number(startMinutes),
      endMinutes: Number(endMinutes),
    });
    return res.status(201).json({ success: true, message: "Pickup time slot created", data });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to create pickup time slot",
    });
  }
}

export async function updatePickupTimeSlotController(req: Request, res: Response) {
  try {
    const { id } = req.params;
    if (typeof id !== "string") {
      return res.status(400).json({ success: false, message: "Invalid pickup time slot id" });
    }
    const { startMinutes, endMinutes, isActive } = req.body ?? {};
    const patch: { startMinutes?: number; endMinutes?: number; isActive?: boolean } = {};
    if (startMinutes !== undefined) patch.startMinutes = Number(startMinutes);
    if (endMinutes !== undefined) patch.endMinutes = Number(endMinutes);
    if (typeof isActive === "boolean") patch.isActive = isActive;
    const data = await updatePickupTimeSlot(id, patch);
    return res.status(200).json({ success: true, message: "Pickup time slot updated", data });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to update pickup time slot",
    });
  }
}

export async function deletePickupTimeSlotController(req: Request, res: Response) {
  try {
    const { id } = req.params;
    if (typeof id !== "string") {
      return res.status(400).json({ success: false, message: "Invalid pickup time slot id" });
    }
    await deletePickupTimeSlot(id);
    return res.status(200).json({ success: true, message: "Pickup time slot deleted" });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to delete pickup time slot",
    });
  }
}
