import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";
import type { Request, Response } from "express";

vi.mock("../../services/auth.service", () => ({
  loginUser: vi.fn(),
  changePassword: vi.fn(),
}));
vi.mock("../../services/vendorVolume.service", () => ({ rankHighVolumeVendors: vi.fn() }));
vi.mock("../../lib/tokenRevocation", () => ({ revokeToken: vi.fn() }));
vi.mock("../../lib/prisma", () => ({ default: {} }));

import { changePasswordController, login, logoutController } from "../auth.controller";
import { changePassword, loginUser } from "../../services/auth.service";
import { revokeToken } from "../../lib/tokenRevocation";
import { ACCESS_TOKEN_AUDIENCE, JWT_ISSUER } from "../../utils/jwtConfig";

const mockedLogin = vi.mocked(loginUser);
const mockedChangePassword = vi.mocked(changePassword);
const mockedRevokeToken = vi.mocked(revokeToken);

function response() {
  const res = {
    cookie: vi.fn(),
    clearCookie: vi.fn(),
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

describe("cookie and Bearer session isolation", () => {
  const originalCsrfSecret = process.env.CSRF_SECRET;
  const originalJwtSecret = process.env.JWT_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CSRF_SECRET = "cookie-isolation-csrf-secret";
    process.env.JWT_SECRET = "cookie-isolation-jwt-secret";
    mockedLogin.mockResolvedValue({
      user: { id: "rider-1", roles: ["rider"] },
      token: "rider-token",
    } as Awaited<ReturnType<typeof loginUser>>);
  });

  afterEach(() => {
    if (originalCsrfSecret === undefined) delete process.env.CSRF_SECRET;
    else process.env.CSRF_SECRET = originalCsrfSecret;
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
  });

  it("keeps dashboard cookies untouched for a Bearer-only rider login", async () => {
    const req = {
      body: { email: "rider@example.com", password: "test-password" },
      header: (name: string) => name === "X-Auth-Mode" ? "bearer" : undefined,
    } as Request;
    const res = response();

    await login(req, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.cookie).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "rider-token" }));
  });

  it("still sets cookies for dashboard login", async () => {
    const req = {
      body: { email: "admin@example.com", password: "test-password" },
      header: () => undefined,
    } as unknown as Request;
    const res = response();

    await login(req, res as unknown as Response);

    expect(res.cookie).toHaveBeenCalledWith("accessToken", "rider-token", expect.any(Object));
    expect(res.cookie).toHaveBeenCalledWith("csrfToken", expect.any(String), expect.any(Object));
  });

  it("revokes a Bearer session without clearing dashboard cookies", async () => {
    const token = jwt.sign({ id: "rider-1" }, process.env.JWT_SECRET!, {
      expiresIn: "1h", jwtid: "rider-session", issuer: JWT_ISSUER, audience: ACCESS_TOKEN_AUDIENCE,
    });
    const req = {
      headers: { authorization: `Bearer ${token}` },
      cookies: { accessToken: "dashboard-cookie" },
    } as unknown as Request;
    const res = response();

    await logoutController(req, res as unknown as Response);

    expect(mockedRevokeToken).toHaveBeenCalledOnce();
    expect(res.clearCookie).not.toHaveBeenCalled();
  });

  it("still clears cookies for dashboard logout", async () => {
    const req = { headers: {}, cookies: { accessToken: "dashboard-cookie" } } as unknown as Request;
    const res = response();

    await logoutController(req, res as unknown as Response);

    expect(res.clearCookie).toHaveBeenCalledWith("accessToken", { path: "/" });
    expect(res.clearCookie).toHaveBeenCalledWith("csrfToken", { path: "/" });
  });

  it("returns a fresh Bearer token after password change without overwriting a dashboard cookie", async () => {
    mockedChangePassword.mockResolvedValue({ token: "replacement-token" } as Awaited<ReturnType<typeof changePassword>>);
    const req = {
      user: { id: "rider-1" },
      headers: { authorization: "Bearer rider-token" },
      body: { currentPassword: "old-password", newPassword: "new-password" },
    } as unknown as Request;
    const res = response();

    await changePasswordController(req, res as unknown as Response);

    expect(res.cookie).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "replacement-token" }));
  });

  it("still refreshes the dashboard cookie after password change", async () => {
    mockedChangePassword.mockResolvedValue({ token: "replacement-token" } as Awaited<ReturnType<typeof changePassword>>);
    const req = {
      user: { id: "admin-1" },
      headers: {},
      body: { currentPassword: "old-password", newPassword: "new-password" },
    } as unknown as Request;
    const res = response();

    await changePasswordController(req, res as unknown as Response);

    expect(res.cookie).toHaveBeenCalledWith("accessToken", "replacement-token", expect.any(Object));
  });
});
