import { describe, it, expect } from "vitest";

import { stripCarrierStaffTag } from "../carrierRemark";

describe("stripCarrierStaffTag", () => {
  // The current tag, written by ncm.service.ts's INBOUND_COMMENT_PREFIX.
  it("strips the current carrier tag and flags the remark as carrier staff", () => {
    expect(stripCarrierStaffTag("[Courier partner] Delivered to receiver")).toEqual({
      text: "Delivered to receiver",
      isCarrierStaff: true,
    });
  });

  // Legacy rows, in any environment that has not run debrand-carrier-remarks.
  it("still strips the pre-rebrand tag", () => {
    expect(stripCarrierStaffTag("[NCM Staff] Delivered to receiver")).toEqual({
      text: "Delivered to receiver",
      isCarrierStaff: true,
    });
  });

  it("leaves an ordinary remark untouched", () => {
    expect(stripCarrierStaffTag("Customer asked to reschedule")).toEqual({
      text: "Customer asked to reschedule",
      isCarrierStaff: false,
    });
  });

  it("does not strip a tag that appears mid-remark", () => {
    const remark = "Vendor says [Courier partner] never called";
    expect(stripCarrierStaffTag(remark)).toEqual({ text: remark, isCarrierStaff: false });
  });

  it("handles an empty remark", () => {
    expect(stripCarrierStaffTag("")).toEqual({ text: "", isCarrierStaff: false });
  });
});
