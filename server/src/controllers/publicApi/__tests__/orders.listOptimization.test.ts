import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../../services/order.service", () => ({ listOrders: vi.fn() }));
vi.mock("../../../services/delivery-rate.service", () => ({ resolveDestinationRef: vi.fn() }));
vi.mock("../../../services/idempotency.service", () => ({ withIdempotency: vi.fn() }));
import { listOrders } from "../../../services/order.service";
import { publicListOrdersController } from "../orders.controller";
const response = () => {
  const res: any = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res); res.json.mockReturnValue(res); return res;
};
beforeEach(() => vi.resetAllMocks());
describe("Partner order list parity", () => {
  it("uses the authenticated vendor service and returns exact totals without accepting foreign vendor scope", async () => {
    const result = { data: [], meta: { page: 2, pageSize: 20, total: 41, totalPages: 3 } };
    vi.mocked(listOrders).mockResolvedValue(result);
    const res = response();
    await publicListOrdersController({ apiKey: { userId: "vendor-user-a", vendorId: "vendor-a" }, query: { vendorId: "vendor-b", status: ["delivered"], page: 2 }, headers: {} } as any, res);
    expect(listOrders).toHaveBeenCalledWith({ id: "vendor-user-a", roles: ["vendor"] }, { status: ["delivered"], page: 2, pageSize: 20 });
    expect(res.json).toHaveBeenCalledWith({ success: true, ...result });
  });
  it("rejects an unauthenticated request before reading orders", async () => {
    const res = response();
    await publicListOrdersController({ query: {}, headers: {} } as any, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(listOrders).not.toHaveBeenCalled();
  });
});
