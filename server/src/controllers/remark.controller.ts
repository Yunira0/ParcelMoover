import { Request, Response } from "express";
import { getRemarkById, listRemarks } from "../services/remark.service";
import { ListRemarksParams } from "../types/remark.type";

export async function listRemarksController(req: Request, res: Response) {
  try {
    const { status, search, fromDate, toDate } = req.query;

    const params: ListRemarksParams = {};
    if (typeof status === "string") params.status = status;
    if (typeof search === "string") params.search = search;
    if (typeof fromDate === "string") params.fromDate = fromDate;
    if (typeof toDate === "string") params.toDate = toDate;

    const remarks = await listRemarks(params);

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
    const { id } = req.params;
    if (typeof id !== "string" || !id) {
      return res.status(400).json({ success: false, message: "Invalid remark id" });
    }
    const remark = await getRemarkById(id);

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
