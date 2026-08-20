import { describe, it, expect } from "vitest";

import { displayAuthor, displayRemarkText, stripCarrierStaffTag } from "../carrierRemark";

describe("stripCarrierStaffTag", () => {
  // The current tag, written by ncm.service.ts's INBOUND_COMMENT_PREFIX.
  it("strips the current carrier tag and flags the remark as carrier staff", () => {
    expect(stripCarrierStaffTag("[Courier partner] Delivered to receiver")).toEqual({
      text: "Delivered to receiver",
      isCarrierStaff: true,
    });
  });

  // The other 3PL. Its tag went unregistered here for a while, which left every
  // Upaya comment showing its raw prefix and an author of "Unknown".
  it("strips the second carrier's tag", () => {
    expect(stripCarrierStaffTag("[Upaya Staff] Out for delivery")).toEqual({
      text: "Out for delivery",
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

describe("displayAuthor", () => {
  it("shows the author's own name", () => {
    expect(displayAuthor("Sunita Devi")).toBe("Sunita Devi");
  });

  // Carrier rows are written with user_id: null, so there is no name to show.
  it("labels an authorless row as Staff rather than Unknown", () => {
    expect(displayAuthor(null)).toBe("Staff");
    expect(displayAuthor(undefined)).toBe("Staff");
    expect(displayAuthor("")).toBe("Staff");
  });

  // Belt and braces: a tagged remark reads as Staff even if the row somehow
  // carries a user, which is how the masking case is expressed at the call site.
  it("labels a carrier-tagged remark as Staff even when a name is present", () => {
    expect(displayAuthor("Sunita Devi", true)).toBe("Staff");
  });
});

describe("displayRemarkText", () => {
  // The stored text is the durable parcel -> carrier-order mapping and cannot be
  // rewritten in place, so the brand comes off on the way out. Both carriers'
  // handoff entries have to read identically once they do.
  it("neutralises the branded handoff remark", () => {
    expect(displayRemarkText("Parcel dispatched via Upaya — order #U9 → Butwal")).toBe(
      "Parcel dispatched to destination — order #U9 → Butwal",
    );
  });

  it("leaves the already-neutral handoff remark alone", () => {
    const remark = "Parcel dispatched to destination — order #123 → Butwal (Pickup)";
    expect(displayRemarkText(remark)).toBe(remark);
  });

  // Three generations of status-update prefix, all reading as Staff now.
  it.each(["NCM", "Upaya", "Courier partner"])("rewrites a '%s:' status update to Staff:", (name) => {
    expect(displayRemarkText(`${name}: delivered (reconciled)`)).toBe("Staff: delivered (reconciled)");
  });

  it("leaves an ordinary remark untouched", () => {
    expect(displayRemarkText("Customer asked to reschedule")).toBe("Customer asked to reschedule");
  });

  // A human note that merely mentions a carrier is not a prefix match.
  it("does not rewrite a carrier name appearing mid-remark", () => {
    const remark = "Vendor says Upaya: never called";
    expect(displayRemarkText(remark)).toBe(remark);
  });
});
