import { describe, it, expect } from "vitest";
import { updateManagedUserSchema } from "../auth.schema";

// Regression: updateManagedUserSchema used to omit the branch-delivery and
// return-percent vendor rate overrides even though registerUserSchema, the
// service layer, and the Edit Vendor form all supported them. Zod strips
// unrecognized keys by default, and the validate() middleware replaces
// req.body with the parsed result - so those fields were silently deleted
// from every PATCH /auth/users/vendor/:id request before reaching the
// service, and the Edit Vendor page's branch/return rate fields never saved.
describe("updateManagedUserSchema - vendor branch/return rate overrides", () => {
  const payload = {
    type: "vendor",
    returnInsideValleyPercent: "0",
    returnOutsideValleyPercent: "50",
    branchFlatInsideValley: "80",
    branchFlatOutsideValley: "180",
    branchZoneMajorCities: "200",
    branchZoneUrbanAreas: "250",
    branchZoneRemoteAreas: "400",
    branchZoneInsideValley: "150",
  };

  it("accepts all branch and return rate override fields", () => {
    const result = updateManagedUserSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it("does not strip any of them out of the parsed result", () => {
    const result = updateManagedUserSchema.safeParse(payload);
    if (!result.success) throw new Error("expected parse to succeed");

    expect(result.data.returnInsideValleyPercent).toBe("0");
    expect(result.data.returnOutsideValleyPercent).toBe("50");
    expect(result.data.branchFlatInsideValley).toBe("80");
    expect(result.data.branchFlatOutsideValley).toBe("180");
    expect(result.data.branchZoneMajorCities).toBe("200");
    expect(result.data.branchZoneUrbanAreas).toBe("250");
    expect(result.data.branchZoneRemoteAreas).toBe("400");
    expect(result.data.branchZoneInsideValley).toBe("150");
  });

  it("still accepts the home-rate fields alongside the branch/return ones", () => {
    const result = updateManagedUserSchema.safeParse({
      ...payload,
      rateType: "zone",
      zoneMajorCities: "155",
      extraWeightPercent: "10",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.zoneMajorCities).toBe("155");
      expect(result.data.extraWeightPercent).toBe("10");
    }
  });
});
