import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { parseMultipartJson } from "../multipartJson.middleware";
import { registerUserSchema, updateManagedUserSchema } from "../../validators/auth.schema";

const baseAdmin = {
  type: "admin",
  fullName: "Test Admin",
  email: "admin@example.com",
  phone: "9800000000",
  password: "password123",
};

function reviveBranchScoped(body: Record<string, unknown>) {
  const req = { body } as Request;
  const next = vi.fn() as NextFunction;

  parseMultipartJson("branchScoped")(req, {} as Response, next);

  expect(next).toHaveBeenCalledOnce();
  return req.body;
}

describe("multipart branchScoped parsing", () => {
  it.each([
    ["true", true],
    ["false", false],
  ])("revives %s before admin registration validation", (multipartValue, expected) => {
    const body = reviveBranchScoped({ ...baseAdmin, branchScoped: multipartValue });
    const result = registerUserSchema.safeParse(body);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.branchScoped).toBe(expected);
  });

  it("revives the flag before a multipart admin update", () => {
    const body = reviveBranchScoped({ type: "admin", branchScoped: "false" });
    const result = updateManagedUserSchema.safeParse(body);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.branchScoped).toBe(false);
  });

  it("leaves invalid values for the schema to reject", () => {
    const body = reviveBranchScoped({ ...baseAdmin, branchScoped: "yes" });

    expect(registerUserSchema.safeParse(body).success).toBe(false);
  });
});
