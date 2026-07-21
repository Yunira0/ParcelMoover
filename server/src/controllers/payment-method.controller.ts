import { Request, Response } from "express";
import {
  listPaymentMethods,
  createPaymentMethod,
  setPaymentMethodActive,
} from "../services/payment-method.service";

export async function listPaymentMethodsController(req: Request, res: Response) {
  try {
    // Non-super-admins (e.g. admins recording a payment) only need the active
    // set; super admins managing the list can request everything.
    const isSuperAdmin = (req.user?.roles ?? []).includes("super_admin");
    const activeOnly = !isSuperAdmin || req.query.activeOnly === "true";
    const data = await listPaymentMethods({ activeOnly });
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load payment methods",
    });
  }
}

export async function createPaymentMethodController(req: Request, res: Response) {
  try {
    const data = await createPaymentMethod(req.body.name);
    return res.status(201).json({ success: true, message: "Payment method added", data });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to add payment method",
    });
  }
}

export async function updatePaymentMethodController(req: Request, res: Response) {
  try {
    const data = await setPaymentMethodActive(String(req.params.id), req.body.isActive);
    return res.status(200).json({ success: true, message: "Payment method updated", data });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to update payment method",
    });
  }
}
