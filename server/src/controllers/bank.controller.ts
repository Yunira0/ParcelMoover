import { Request, Response } from "express";
import { listBanks, createBank, updateBank } from "../services/bank.service";

const fail = (res: Response, error: any, fallback: string) =>
  res.status(error.statusCode || 500).json({ success: false, message: error.message || fallback });

export async function listBanksController(_req: Request, res: Response) {
  try {
    return res.status(200).json({ success: true, data: await listBanks() });
  } catch (error) {
    return fail(res, error, "Failed to load banks");
  }
}

export async function createBankController(req: Request, res: Response) {
  try {
    const data = await createBank(req.body);
    return res.status(201).json({ success: true, message: "Bank added", data });
  } catch (error) {
    return fail(res, error, "Failed to add bank");
  }
}

export async function updateBankController(req: Request, res: Response) {
  try {
    const data = await updateBank(String(req.params.id), req.body);
    return res.status(200).json({ success: true, message: "Bank updated", data });
  } catch (error) {
    return fail(res, error, "Failed to update bank");
  }
}
