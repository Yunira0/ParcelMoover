import { describe, it, expect, vi } from "vitest";

vi.mock("../../lib/prisma", () => ({ default: {}, pool: {} }));

import { methodNamesOf, unmappedMethods } from "../accounting/repair";

const ACCOUNTS = new Map([["prabhu bank", "1102"], ["fonepay 9851415909 - kumari bank", "1100"]]);

describe("methodNamesOf", () => {
  it("reads every breakdown line, not the summary beside it", () => {
    expect(
      methodNamesOf({
        payments: [{ method: "Cash", amount: 100 }, { method: "Online", amount: 50 }],
        payment_method: "Cash, Online",
        instalments: [{ method: "Cash, Online", breakdown: [{ method: "Cash", amount: 100 }, { method: "Online", amount: 50 }] }],
      }),
    ).toEqual(["Cash", "Online"]);
  });

  it("falls back to the summary method where there is no breakdown, as posting does", () => {
    expect(methodNamesOf({ payments: null, payment_method: "Recorded", instalments: [{ method: "Fonepay", breakdown: null }] }))
      .toEqual(["Recorded", "Fonepay"]);
  });
});

describe("unmappedMethods", () => {
  it("flags only names posting can't find an account for", () => {
    // Cash always posts to 1000; a renamed method's old name does not match the new one.
    expect(unmappedMethods(["Cash", "Prabhu Bank", "Fonepay", "Online"], ACCOUNTS)).toEqual(["Fonepay", "Online"]);
  });
});
