import { Request, Response } from "express";
import {
  getRemarkById,
  listRemarks,
  setRemarkStatus,
  getUnclosedRemarksCount,
  type RemarkWorkflowStatus,
} from "../services/remark.service";
import { ListRemarksParams } from "../types/remark.type";

export async function listRemarksController(req: Request, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });
    const { status, search, fromDate, toDate } = req.query;

    const params: ListRemarksParams = {};
    if (typeof status === "string") params.status = status;
    if (typeof search === "string") params.search = search;
    if (typeof fromDate === "string") params.fromDate = fromDate;
    if (typeof toDate === "string") params.toDate = toDate;

    const remarks = await listRemarks({ id: req.user.id, roles: req.user.roles }, params);

    return res.status(200).json({ success: true, data: remarks });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load remarks",
    });
  }
}

export async function getRemarkByIdController(req: Request, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });
    const { id } = req.params;
    if (typeof id !== "string" || !id) {
      return res.status(400).json({ success: false, message: "Invalid remark id" });
    }
    const remark = await getRemarkById({ id: req.user.id, roles: req.user.roles }, id);

    if (!remark) {
      return res.status(404).json({ success: false, message: "Remark not found" });
    }

    return res.status(200).json({ success: true, data: remark });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load remark",
    });
  }
}

export async function setRemarkStatusController(req: Request, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });
    const { id } = req.params;
    const { status } = req.body;
    if (typeof id !== "string") {
      return res.status(400).json({ success: false, message: "Invalid remark id" });
    }
    if (status !== "open" && status !== "pending" && status !== "closed") {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }
    const result = await setRemarkStatus(
      { id: req.user.id, roles: req.user.roles },
      id,
      status as RemarkWorkflowStatus,
    );
    return res.status(200).json({ success: true, message: "Status updated", data: result });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to update status",
    });
  }
}

export async function getUnclosedRemarksCountController(req: Request, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });
    const count = await getUnclosedRemarksCount({ id: req.user.id, roles: req.user.roles });
    return res.status(200).json({ success: true, data: { count } });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load unclosed remarks count",
    });
  }
}
