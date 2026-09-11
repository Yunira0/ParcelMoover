// A file-filter rejection (unsupported type) and a MulterError (file too
// large, too many files) used to both fall through to the generic 500
// "Internal server error" branch - the actual cause of vendor/admin/rider
// create-or-edit failing with a useless message on some devices (an iPhone's
// HEIC photo, or an oversized camera shot). These lock down that both now
// surface as a proper 400 naming the real problem.
import type { Request, Response } from "express";
import multer from "multer";
import { describe, expect, it, vi } from "vitest";
import { errorHandler } from "../errorHandler.middleware";
import { AppError } from "../../utils/AppError";

function mockRes() {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("errorHandler", () => {
  it("reports a fileFilter rejection (now an AppError) as 400 with its real message", () => {
    const res = mockRes();

    errorHandler(
      new AppError(400, "Only JPG, PNG, WebP, and PDF files are allowed"),
      {} as Request,
      res,
      vi.fn(),
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: "Only JPG, PNG, WebP, and PDF files are allowed" }),
    );
  });

  it("reports a MulterError (file too large) as 400, not a generic 500", () => {
    const res = mockRes();
    const err = new multer.MulterError("LIMIT_FILE_SIZE");

    errorHandler(err, {} as Request, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(body.success).toBe(false);
    expect(body.message).not.toMatch(/internal server error/i);
  });

  it("still falls back to a generic 500 for a genuinely unexpected error", () => {
    const res = mockRes();

    errorHandler(new Error("boom"), {} as Request, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: "Internal server error" }),
    );
  });
});
