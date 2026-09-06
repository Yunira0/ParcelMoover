import type { Request, Response } from "express";
import {
  createBranchSettlement, createOrPromoteBranch, exportBranchOrders, getBranchOverview,
  listBranchesForTracking, listBranchOrders, listBranchSettlements,
} from "../services/branch.service";

const actor = (req: Request) => ({ id: req.user!.id, roles: req.user!.roles });
const fail = (res: Response, error: any, message: string) => res.status(error.statusCode || 500).json({ success: false, message: error.message || message });

export async function listBranchesController(_req: Request, res: Response) {
  try { return res.json({ success: true, data: await listBranchesForTracking() }); }
  catch (e) { return fail(res, e, "Failed to load branches"); }
}
export async function branchOverviewController(req: Request, res: Response) {
  try { return res.json({ success: true, data: await getBranchOverview(req.query as any) }); }
  catch (e) { return fail(res, e, "Failed to load branch overview"); }
}
export async function branchOrdersController(req: Request, res: Response) {
  try { const result = await listBranchOrders(actor(req), req.query as any); return res.json({ success: true, ...result }); }
  catch (e) { return fail(res, e, "Failed to load branch orders"); }
}
export async function branchOrdersExportController(req: Request, res: Response) {
  try { const result = await exportBranchOrders(actor(req), req.query as any); return res.json({ success: true, ...result }); }
  catch (e) { return fail(res, e, "Failed to export branch orders"); }
}
export async function createBranchController(req: Request, res: Response) {
  try { return res.status(201).json({ success: true, data: await createOrPromoteBranch(actor(req), req.body) }); }
  catch (e) { return fail(res, e, "Failed to save branch"); }
}
export async function listBranchSettlementsController(req: Request, res: Response) {
  try { return res.json({ success: true, ...(await listBranchSettlements(req.query as any)) }); }
  catch (e) { return fail(res, e, "Failed to load branch settlements"); }
}
export async function createBranchSettlementController(req: Request, res: Response) {
  try { return res.status(201).json({ success: true, data: await createBranchSettlement(actor(req), req.body) }); }
  catch (e) { return fail(res, e, "Failed to create branch settlement"); }
}
