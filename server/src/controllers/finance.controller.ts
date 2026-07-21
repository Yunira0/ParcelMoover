import { Request, Response } from "express";
import { getPendingCodBill, listOrderCod, listSettlements, getUnsettledOrders, createSettlement, payForSettlement, updateSettlement, getSettlementDetail } from "../services/finance.service";
import { CodPaymentFilter, CreateSettlementInput, PaySettlementInput, UpdateSettlementInput } from "../types/finance.type";

// General UUID shape — not strict about RFC-4122 version/variant nibbles, so
// seeded/demo ids (e.g. 55555555-0000-0000-0000-000000000002) are accepted.
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseVendorIdParam(req: Request): { error?: string; vendorId?: string } {
  const raw = req.query.vendorId;
  if (raw === undefined) return {};
  if (typeof raw !== "string" || !UUID_REGEX.test(raw)) {
    return { error: "vendorId must be a valid UUID" };
  }
  return { vendorId: raw };
}

function parsePagination(req: Request): {
  error?: string;
  page?: number | undefined;
  pageSize?: number | undefined;
} {
  let page: number | undefined;
  let pageSize: number | undefined;

  if (req.query.page !== undefined) {
    page = Number(req.query.page);
    if (!Number.isInteger(page) || page < 1) {
      return { error: "page must be a positive integer" };
    }
  }
  if (req.query.pageSize !== undefined) {
    pageSize = Number(req.query.pageSize);
    if (!Number.isInteger(pageSize) || pageSize < 1) {
      return { error: "pageSize must be a positive integer" };
    }
  }

  return { page, pageSize };
}

export async function getPendingCodController(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { error, vendorId } = parseVendorIdParam(req);
    if (error) {
      return res.status(400).json({ success: false, message: error });
    }

    const bill = await getPendingCodBill({ id: req.user.id, roles: req.user.roles }, vendorId);
    return res.status(200).json({ success: true, data: bill });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load pending COD",
    });
  }
}

const VALID_COD_STATUS_FILTERS: CodPaymentFilter[] = ["settled", "not_settled"];

export async function listOrderCodController(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { error: vendorError, vendorId } = parseVendorIdParam(req);
    if (vendorError) {
      return res.status(400).json({ success: false, message: vendorError });
    }

    const { error: pageError, page, pageSize } = parsePagination(req);
    if (pageError) {
      return res.status(400).json({ success: false, message: pageError });
    }

    let status: CodPaymentFilter | undefined;
    if (req.query.status !== undefined) {
      if (typeof req.query.status !== "string" || !VALID_COD_STATUS_FILTERS.includes(req.query.status as CodPaymentFilter)) {
        return res.status(400).json({
          success: false,
          message: `status must be one of: ${VALID_COD_STATUS_FILTERS.join(", ")}`,
        });
      }
      status = req.query.status as CodPaymentFilter;
    }

    const result = await listOrderCod(
      { id: req.user.id, roles: req.user.roles },
      vendorId,
      status,
      page,
      pageSize,
    );
    return res.status(200).json({ success: true, ...result });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load order COD payments",
    });
  }
}

function parseDateParam(raw: unknown, label: string): { error?: string; date?: Date } {
  if (raw === undefined) return {};
  if (typeof raw !== "string") {
    return { error: `${label} must be a date string` };
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return { error: `${label} must be a valid date` };
  }
  return { date };
}

const VALID_PAYEE_TYPES = ["rider", "vendor"];

export async function listSettlementsController(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const payeeType = req.query.payeeType;
    if (typeof payeeType !== "string" || !VALID_PAYEE_TYPES.includes(payeeType)) {
      return res.status(400).json({
        success: false,
        message: `payeeType must be one of: ${VALID_PAYEE_TYPES.join(", ")}`,
      });
    }

    const targetId = req.query.targetId;
    if (targetId !== undefined && (typeof targetId !== "string" || !UUID_REGEX.test(targetId))) {
      return res.status(400).json({ success: false, message: "targetId must be a valid UUID" });
    }

    const { error: pageError, page, pageSize } = parsePagination(req);
    if (pageError) {
      return res.status(400).json({ success: false, message: pageError });
    }

    const { error: fromError, date: fromDate } = parseDateParam(req.query.fromDate, "fromDate");
    if (fromError) {
      return res.status(400).json({ success: false, message: fromError });
    }
    const { error: toError, date: toDate } = parseDateParam(req.query.toDate, "toDate");
    if (toError) {
      return res.status(400).json({ success: false, message: toError });
    }
    if (fromDate && toDate && fromDate > toDate) {
      return res.status(400).json({ success: false, message: "fromDate must be before toDate" });
    }

    const result = await listSettlements(
      { id: req.user.id, roles: req.user.roles },
      payeeType as "rider" | "vendor",
      targetId as string | undefined,
      page,
      pageSize,
      fromDate,
      toDate,
    );
    return res.status(200).json({ success: true, ...result });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load settlements",
    });
  }
}

export async function createSettlementController(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const input = req.body as CreateSettlementInput;
    const settlement = await createSettlement({ id: req.user.id, roles: req.user.roles }, input);

    return res.status(201).json({ success: true, message: "Settlement created", data: settlement });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to create settlement",
    });
  }
}

export async function payForSettlementController(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { id } = req.params;
    if (typeof id !== "string" || !UUID_REGEX.test(id)) {
      return res.status(400).json({ success: false, message: "Invalid settlement id" });
    }

    const input = req.body as PaySettlementInput;
    const settlement = await payForSettlement({ id: req.user.id, roles: req.user.roles }, id, input);

    return res.status(200).json({ success: true, message: "Payment recorded", data: settlement });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to record payment",
    });
  }
}

export async function updateSettlementController(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { id } = req.params;
    if (typeof id !== "string" || !UUID_REGEX.test(id)) {
      return res.status(400).json({ success: false, message: "Invalid settlement id" });
    }

    const input = req.body as UpdateSettlementInput;
    const settlement = await updateSettlement({ id: req.user.id, roles: req.user.roles }, id, input.codCollectionIds);

    return res.status(200).json({ success: true, message: "Settlement updated", data: settlement });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to update settlement",
    });
  }
}

const VALID_SETTLEMENT_TYPES = ["rider", "vendor"];

export async function getUnsettledOrdersController(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const type = req.query.type;
    if (typeof type !== "string" || !VALID_SETTLEMENT_TYPES.includes(type)) {
      return res.status(400).json({
        success: false,
        message: `type must be one of: ${VALID_SETTLEMENT_TYPES.join(", ")}`,
      });
    }

    const targetId = req.query.targetId;
    if (targetId !== undefined && (typeof targetId !== "string" || !UUID_REGEX.test(targetId))) {
      return res.status(400).json({ success: false, message: "targetId must be a valid UUID" });
    }

    const result = await getUnsettledOrders(
      { id: req.user.id, roles: req.user.roles },
      type as "rider" | "vendor",
      targetId as string | undefined,
    );
    return res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load unsettled orders",
    });
  }
}

export async function getSettlementDetailController(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { id } = req.params;
    if (typeof id !== "string" || !UUID_REGEX.test(id)) {
      return res.status(400).json({ success: false, message: "Invalid settlement id" });
    }

    const detail = await getSettlementDetail({ id: req.user.id, roles: req.user.roles }, id);
    return res.status(200).json({ success: true, data: detail });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load settlement detail",
    });
  }
}
