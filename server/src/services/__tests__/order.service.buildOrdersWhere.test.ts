// Return Operations' ready_to_return/returned_to_vendor tabs need one query to
// express "status IN (...) OR (order_type = X AND status IN (Y))" - previously
// buildOrdersWhere could only AND status and orderType together, forcing the
// page to run two separate exhaustive sweeps and merge them client-side. This
// locks down the new secondaryOrderType/secondaryStatus OR combinator, and
// that every other caller (which never sets them) is unaffected.
import { describe, it, expect } from "vitest";
import { buildOrdersWhere } from "../order.service";

const SCOPE = { vendorId: undefined, riderId: undefined };

describe("buildOrdersWhere - secondaryOrderType/secondaryStatus", () => {
  it("ORs the primary status match with the secondary order_type+status match when both are set", () => {
    const where = buildOrdersWhere(SCOPE, {
      status: ["ready_to_return"],
      secondaryOrderType: "return",
      secondaryStatus: ["pickup_ordered", "rider_assigned"],
    } as any);

    expect(where.AND).toContainEqual({
      OR: [
        { status: { in: ["ready_to_return"] } },
        { order_type: "return", status: { in: ["pickup_ordered", "rider_assigned"] } },
      ],
    });
  });

  it("falls back to a plain status AND-condition when only status is set", () => {
    const where = buildOrdersWhere(SCOPE, { status: ["sent_to_vendor"] } as any);

    expect(where.AND).toContainEqual({ status: { in: ["sent_to_vendor"] } });
    expect(JSON.stringify(where)).not.toContain("secondaryOrderType");
  });

  it("does not OR when secondaryOrderType is set but secondaryStatus is empty", () => {
    const where = buildOrdersWhere(SCOPE, {
      status: ["returned_to_vendor"],
      secondaryOrderType: "return",
      secondaryStatus: [],
    } as any);

    expect(where.AND).toContainEqual({ status: { in: ["returned_to_vendor"] } });
  });
});
