import { Request, Response } from "express";
import {
  REGISTER_KINDS,
  type RegisterKind,
  cancelPurchaseBill,
  createPurchaseBill,
  getVatRegister,
} from "../services/vat-register.service";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fail = (res: Response, error: any, fallback: string) =>
  res.status(error.statusCode || 500).json({ success: false, message: error.message || fallback });

// GET /api/finance/vat-registers/:kind?year=2083&month=5
export async function getVatRegisterController(req: Request, res: Response) {
  try {
    const kind = req.params.kind as RegisterKind;
    if (!REGISTER_KINDS.includes(kind)) {
      return res.status(404).json({ success: false, message: "Unknown register" });
    }
    const { year, month } = req.query as unknown as { year: number; month: number };
    const data = await getVatRegister({ id: req.user!.id, roles: req.user!.roles }, kind, year, month);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return fail(res, error, "Failed to load the register");
  }
}

// POST /api/finance/purchase-bills
export async function createPurchaseBillController(req: Request, res: Response) {
  try {
    const data = await createPurchaseBill({ id: req.user!.id, roles: req.user!.roles }, req.body);
    return res.status(201).json({ success: true, message: "Purchase bill added", data });
  } catch (error: any) {
    return fail(res, error, "Failed to add the purchase bill");
  }
}

// POST /api/finance/purchase-bills/:id/cancel
export async function cancelPurchaseBillController(req: Request, res: Response) {
  try {
    const { id } = req.params;
    if (typeof id !== "string" || !UUID_REGEX.test(id)) {
      return res.status(400).json({ success: false, message: "Invalid purchase bill id" });
    }
    const data = await cancelPurchaseBill({ id: req.user!.id, roles: req.user!.roles }, id, req.body.remark);
    return res.status(200).json({ success: true, message: "Purchase bill cancelled", data });
  } catch (error: any) {
    return fail(res, error, "Failed to cancel the purchase bill");
  }
}
