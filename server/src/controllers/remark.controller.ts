import { Request, Response } from "express";
import { createRemark, listRemarks, replyToRemark } from "../services/remark.service";

export async function listRemarksController(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { id } = req.params;
    if (typeof id !== "string" || !id) {
      return res.status(400).json({ success: false, message: "Invalid order id" });
    }

    const data = await listRemarks({ id: req.user.id, roles: req.user.roles }, id);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load remarks",
    });
  }
}

export async function createRemarkController(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { id } = req.params;
    if (typeof id !== "string" || !id) {
      return res.status(400).json({ success: false, message: "Invalid order id" });
    }

    const created = await createRemark(
      { id: req.user.id, roles: req.user.roles },
      id,
      req.body?.remark,
    );

    return res.status(201).json({
      success: true,
      message: "Remark added",
      data: created,
    });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to add remark",
    });
  }
}

export async function replyToRemarkController(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { id, remarkId } = req.params;
    if (typeof id !== "string" || !id || typeof remarkId !== "string" || !remarkId) {
      return res.status(400).json({ success: false, message: "Invalid order or remark id" });
    }

    const created = await replyToRemark(
      { id: req.user.id, roles: req.user.roles },
      id,
      remarkId,
      req.body?.remark,
    );

    return res.status(201).json({
      success: true,
      message: "Reply added",
      data: created,
    });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to add reply",
    });
  }
}
