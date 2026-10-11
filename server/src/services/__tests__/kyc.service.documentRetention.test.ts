import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { db, unlink } = vi.hoisted(() => ({
  db: {
    vendors: { findFirst: vi.fn() },
    vendor_kyc_applications: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    audit_logs: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  unlink: vi.fn(),
}));
vi.mock("../../lib/prisma", () => ({ default: db }));
vi.mock("fs/promises", () => ({ unlink }));
vi.mock("../../lib/mailer", () => ({ sendWelcomeEmail: vi.fn() }));
vi.mock("../billing.service", () => ({ getDefaultCreditLimit: vi.fn() }));

import { purgeExpiredRejectedKycDocuments } from "../kyc.service";

const documentPath = "uploads/registration/original.pdf";
const candidate = (overrides = {}) => ({
  id: "rejected-1", citizenship_doc_front: null, citizenship_doc_back: null,
  pan_vat_doc: null, business_cert_doc: null, ...overrides,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-06T00:00:00.000Z"));
  db.$transaction.mockImplementation(fn => fn(db));
  db.vendors.findFirst.mockResolvedValue(null);
  db.vendor_kyc_applications.findFirst.mockResolvedValue(null);
  db.vendor_kyc_applications.findMany.mockResolvedValue([]);
  unlink.mockResolvedValue(undefined);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("rejected KYC document retention", () => {
  it.each([
    ["citizenship_doc_front", "citizenship_doc"],
    ["citizenship_doc_back", "citizenship_doc_back"],
    ["pan_vat_doc", "pan_vat_doc"],
    ["business_cert_doc", "business_cert_doc"],
  ])("retains %s when a vendor still references it", async (applicationField, vendorField) => {
    db.vendor_kyc_applications.findMany.mockResolvedValue([candidate({ [applicationField]: documentPath })]);
    db.vendors.findFirst.mockResolvedValue({ id: "existing-vendor" });

    await expect(purgeExpiredRejectedKycDocuments()).resolves.toEqual({ checked: 1, purged: 1 });

    expect(unlink).not.toHaveBeenCalled();
    expect(db.vendors.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: expect.arrayContaining([{ [vendorField]: documentPath }]) },
    }));
    // Only the old rejection loses its reference; the vendor's file remains.
    expect(db.vendor_kyc_applications.update).toHaveBeenCalledWith({
      where: { id: "rejected-1" }, data: { [applicationField]: null },
    });
  });

  it.each(["pending", "approved", "rejected"])("retains a file shared with another %s application", async status => {
    db.vendor_kyc_applications.findMany.mockResolvedValue([candidate({ citizenship_doc_front: documentPath })]);
    db.vendor_kyc_applications.findFirst.mockResolvedValue({ id: "other-application", status });

    await purgeExpiredRejectedKycDocuments();

    expect(unlink).not.toHaveBeenCalled();
    expect(db.vendor_kyc_applications.findFirst).toHaveBeenCalledWith({
      where: {
        id: { not: "rejected-1" },
        OR: [
          { citizenship_doc_front: documentPath }, { citizenship_doc_back: documentPath },
          { pan_vat_doc: documentPath }, { business_cert_doc: documentPath },
        ],
      },
      select: { id: true },
    });
  });

  it("deletes an unshared expired document and records the released reference", async () => {
    db.vendor_kyc_applications.findMany.mockResolvedValue([candidate({ pan_vat_doc: documentPath })]);

    await purgeExpiredRejectedKycDocuments();

    expect(unlink).toHaveBeenCalledOnce();
    // Normalised so the check holds on Windows, where the path is built with backslashes.
    expect(unlink).toHaveBeenCalledWith(expect.stringContaining(path.normalize(documentPath)));
    expect(db.vendor_kyc_applications.update).toHaveBeenCalledWith({ where: { id: "rejected-1" }, data: { pan_vat_doc: null } });
    expect(db.audit_logs.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "KYC_PURGE_DOCUMENTS", new_data: { purgedFields: ["pan_vat_doc"], retentionDays: 30 } }),
    }));
    expect(db.vendor_kyc_applications.findMany.mock.calls[0]![0].where).toMatchObject({
      status: "rejected", reviewed_at: { lt: new Date("2026-09-06T00:00:00.000Z") },
    });
  });

  it("keeps a reference when the filesystem refuses deletion", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.vendor_kyc_applications.findMany.mockResolvedValue([candidate({ business_cert_doc: documentPath })]);
    unlink.mockRejectedValue({ code: "EACCES" });

    await expect(purgeExpiredRejectedKycDocuments()).resolves.toEqual({ checked: 1, purged: 0 });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("clears an already-missing, unshared document so retry can finish", async () => {
    db.vendor_kyc_applications.findMany.mockResolvedValue([candidate({ pan_vat_doc: documentPath })]);
    unlink.mockRejectedValue({ code: "ENOENT" });

    await expect(purgeExpiredRejectedKycDocuments()).resolves.toEqual({ checked: 1, purged: 1 });
  });

  it("never deletes when the reference check is unavailable", async () => {
    db.vendor_kyc_applications.findMany.mockResolvedValue([candidate({ citizenship_doc_front: documentPath })]);
    db.vendors.findFirst.mockRejectedValue(new Error("Reference check unavailable"));

    await expect(purgeExpiredRejectedKycDocuments()).rejects.toThrow("Reference check unavailable");
    expect(unlink).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
