import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../services/order.service", () => ({
  getMerchantOverview: vi.fn(async () => ({ ok: true })),
  getSalesOverview: vi.fn(async () => ({ ok: true })),
  getRiderOverview: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../../services/ncm.service", () => ({ syncRemarkToNcm: vi.fn() }));
vi.mock("../../services/idempotency.service", () => ({ withIdempotency: vi.fn() }));

import { merchantOverviewController, riderOverviewController, salesOverviewController } from "../order.controller";
import { getMerchantOverview, getRiderOverview, getSalesOverview } from "../../services/order.service";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function response() {
  const res: any = {
    statusCode: 0,
    body: null,
    status(code: number) { res.statusCode = code; return res; },
    json(body: unknown) { res.body = body; return res; },
  };
  return res;
}

const request = (query: Record<string, string>) => ({ user: { id: "staff", roles: ["super_admin"] }, query }) as any;

// The overview cards (Vendor, Sales, Rider) all parse dates here. A broken
// day check once rejected every real date with a 400, which the pages swallow,
// so the cards silently ignored the date filter while the table applied it.
describe.each([
  ["merchant", merchantOverviewController, getMerchantOverview, "vendorId"],
  ["sales", salesOverviewController, getSalesOverview, "salesUserId"],
  ["rider", riderOverviewController, getRiderOverview, "riderId"],
] as const)("%s overview date filter", (_name, controller, service, idKey) => {
  beforeEach(() => vi.mocked(service).mockClear());

  it("passes a real date range through to the summary", async () => {
    const res = response();
    await controller(request({ [idKey]: id, dateFrom: "2026-10-01", dateTo: "2026-10-07" }), res);
    expect(res.statusCode).toBe(200);
    expect(service).toHaveBeenCalledWith(expect.anything(), id, "2026-10-01", "2026-10-07");
  });

  it("still rejects a malformed date", async () => {
    const res = response();
    await controller(request({ dateFrom: "07/10/2026" }), res);
    expect(res.statusCode).toBe(400);
    expect(service).not.toHaveBeenCalled();
  });
});
