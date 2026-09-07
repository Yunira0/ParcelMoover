import type { Request, Response } from "express";
import {
  createBranchSettlement, createOrPromoteBranch, exportBranchOrders, getBranchOverview,
  getBranchSettlementDetail, listBranchesForTracking, listBranchOrders, listBranchSettlements,
  payBranchSettlement,
} from "../services/branch.service";
import {
  getBranchBillingForActor, listBranchBalances, listBranchPayments, reviewBranchPayment, submitBranchPayment,
} from "../services/branch-billing.service";
import { flattenMulterFiles, secureUploadedFiles } from "../lib/secureUploadedFiles";

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
  try { return res.json({ success: true, ...(await listBranchSettlements(actor(req), req.query as any)) }); }
  catch (e) { return fail(res, e, "Failed to load branch settlements"); }
}
export async function createBranchSettlementController(req: Request, res: Response) {
  try { return res.status(201).json({ success: true, data: await createBranchSettlement(actor(req), req.body) }); }
  catch (e) { return fail(res, e, "Failed to create branch settlement"); }
}
export async function getBranchSettlementController(req: Request, res: Response) {
  try { return res.json({ success: true, data: await getBranchSettlementDetail(actor(req), String(req.params.id)) }); }
  catch (e) { return fail(res, e, "Failed to load branch settlement"); }
}
export async function payBranchSettlementController(req: Request, res: Response) {
  try {
    const data = await payBranchSettlement(actor(req), String(req.params.id), req.body);
    return res.json({ success: true, message: data.status === "settled" ? "Branch settlement completed" : "Part payment recorded", data });
  } catch (e) { return fail(res, e, "Failed to record branch settlement payment"); }
}

export async function getBranchBillingStatusController(req: Request, res: Response) {
  try { return res.json({ success: true, data: await getBranchBillingForActor(actor(req), req.query.branchId as string | undefined) }); }
  catch (e) { return fail(res, e, "Failed to load branch billing status"); }
}
export async function listBranchBalancesController(req: Request, res: Response) {
  try { return res.json({ success: true, data: await listBranchBalances(actor(req)) }); }
  catch (e) { return fail(res, e, "Failed to load branch balances"); }
}
export async function listBranchPaymentsController(req: Request, res: Response) {
  try { return res.json({ success: true, ...(await listBranchPayments(actor(req), req.query as any)) }); }
  catch (e) { return fail(res, e, "Failed to load branch payments"); }
}
export async function submitBranchPaymentController(req: Request, res: Response) {
  try {
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const proof = files?.proof?.[0];
    if (proof) await secureUploadedFiles(flattenMulterFiles(files));
    const data = await submitBranchPayment(actor(req), { ...req.body, amount: Number(req.body.amount), proofPath: proof ? `uploads/billing/${proof.filename}` : null });
    return res.status(201).json({ success: true, message: "Payment submitted. It will be credited once the office verifies it.", data });
  } catch (e) { return fail(res, e, "Failed to submit branch payment"); }
}
export async function reviewBranchPaymentController(req: Request, res: Response) {
  try { return res.json({ success: true, data: await reviewBranchPayment(actor(req), String(req.params.id), req.body.decision, req.body.remark) }); }
  catch (e) { return fail(res, e, "Failed to review branch payment"); }
}
