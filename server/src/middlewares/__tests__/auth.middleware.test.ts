import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import jwt from "jsonwebtoken";
import type { Request, Response } from "express";
import { AppError } from "../../utils/AppError";

vi.mock("../../lib/prisma", () => ({
  default: { users: { findFirst: vi.fn() } },
  pool: {},
}));
vi.mock("../../lib/tokenRevocation", () => ({
  isTokenRevoked: vi.fn(),
  isIssuedBeforeUserRevocation: vi.fn(),
}));

import { authMiddleware } from "../auth.middleware";
import prisma from "../../lib/prisma";
import { isTokenRevoked, isIssuedBeforeUserRevocation } from "../../lib/tokenRevocation";
import { ACCESS_TOKEN_AUDIENCE, JWT_ISSUER } from "../../utils/jwtConfig";

const JWT_SECRET = "test-jwt-secret";

function signAccessToken(payload: Record<string, unknown>) {
  return jwt.sign(payload, JWT_SECRET, { issuer: JWT_ISSUER, audience: ACCESS_TOKEN_AUDIENCE });
}

const mockedPrisma = prisma as unknown as { users: { findFirst: ReturnType<typeof vi.fn> } };
const mockedIsTokenRevoked = isTokenRevoked as unknown as ReturnType<typeof vi.fn>;
const mockedIsIssuedBeforeUserRevocation = isIssuedBeforeUserRevocation as unknown as ReturnType<typeof vi.fn>;

function makeRes() {
  const res: Partial<Response> & { statusCode?: number; body?: unknown } = {};
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res as Response;
  }) as unknown as Response["status"];
  res.json = vi.fn((body: unknown) => {
    res.body = body;
    return res as Response;
  }) as unknown as Response["json"];
  return res as Response & { statusCode?: number; body?: unknown };
}

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    cookies: {},
    originalUrl: "/api/orders",
    ...overrides,
  } as unknown as Request;
}

const activeUser = {
  id: "user-1",
  full_name: "Test User",
  email: "test@example.com",
  phone: null,
  status: "active",
  user_roles: [{ roles: { code: "admin" } }],
};

describe("authMiddleware", () => {
  const originalJwtSecret = process.env.JWT_SECRET;

  beforeEach(() => {
    process.env.JWT_SECRET = JWT_SECRET;
    mockedIsTokenRevoked.mockResolvedValue(false);
    mockedIsIssuedBeforeUserRevocation.mockResolvedValue(false);
    mockedPrisma.users.findFirst.mockResolvedValue(activeUser);
  });

  afterEach(() => {
    process.env.JWT_SECRET = originalJwtSecret;
    vi.restoreAllMocks();
  });

  it("returns 401 when no token is provided", async () => {
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();

    await authMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.body).toMatchObject({ success: false, message: "Authentication required" });
  });

  it("returns 401 for a malformed/invalid token instead of leaking internals", async () => {
    const req = makeReq({ cookies: { accessToken: "not-a-real-jwt" } });
    const res = makeRes();
    const next = vi.fn();

    await authMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.body).toMatchObject({ success: false, message: "Unauthorized" });
  });

  it("forwards a missing JWT_SECRET to the error handler instead of masking it as 401", async () => {
    delete process.env.JWT_SECRET;
    const req = makeReq({ cookies: { accessToken: "irrelevant" } });
    const res = makeRes();
    const next = vi.fn();

    await authMiddleware(req, res, next);

    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    const forwardedError = next.mock.calls[0]?.[0];
    expect(forwardedError).toBeInstanceOf(AppError);
    expect((forwardedError as AppError).statusCode).toBe(500);
  });

  it("returns 401 for a token signed with the wrong audience (e.g. a token minted for a different service)", async () => {
    const token = jwt.sign({ id: "user-1" }, JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: "some-other-audience",
    });
    const req = makeReq({ cookies: { accessToken: token } });
    const res = makeRes();
    const next = vi.fn();

    await authMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 401 when the token has been revoked", async () => {
    mockedIsTokenRevoked.mockResolvedValue(true);
    const token = signAccessToken({ id: "user-1", jti: "abc" });
    const req = makeReq({ cookies: { accessToken: token } });
    const res = makeRes();
    const next = vi.fn();

    await authMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.body).toMatchObject({
      success: false,
      message: "Session has been revoked, please log in again",
    });
  });

  it("forwards a database failure to the error handler instead of masking it as 401", async () => {
    mockedPrisma.users.findFirst.mockRejectedValue(new Error("connection refused"));
    const token = signAccessToken({ id: "user-1" });
    const req = makeReq({ cookies: { accessToken: token } });
    const res = makeRes();
    const next = vi.fn();

    await authMiddleware(req, res, next);

    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    const forwardedError = next.mock.calls[0]?.[0];
    expect(forwardedError).toBeInstanceOf(Error);
    expect((forwardedError as Error).message).toBe("connection refused");
  });

  it("returns 401 when the user no longer exists or is inactive", async () => {
    mockedPrisma.users.findFirst.mockResolvedValue(null);
    const token = signAccessToken({ id: "user-1" });
    const req = makeReq({ cookies: { accessToken: token } });
    const res = makeRes();
    const next = vi.fn();

    await authMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.body).toMatchObject({ success: false, message: "User not found or inactive" });
  });

  it("calls next() and populates req.user for a valid token", async () => {
    const token = signAccessToken({ id: "user-1" });
    const req = makeReq({ cookies: { accessToken: token } });
    const res = makeRes();
    const next = vi.fn();

    await authMiddleware(req, res, next);

    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
    expect(req.user).toMatchObject({ id: "user-1", roles: ["admin"] });
  });

  it("supports a Bearer token in the Authorization header", async () => {
    const token = signAccessToken({ id: "user-1" });
    const req = makeReq({ headers: { authorization: `Bearer ${token}` } });
    const res = makeRes();
    const next = vi.fn();

    await authMiddleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user).toMatchObject({ id: "user-1" });
  });

  it("blocks a must-change-password user from a non-allowlisted route", async () => {
    const token = signAccessToken({ id: "user-1", mustChangePassword: true });
    const req = makeReq({ cookies: { accessToken: token }, originalUrl: "/api/orders" });
    const res = makeRes();
    const next = vi.fn();

    await authMiddleware(req, res, next);

    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    const forwardedError = next.mock.calls[0]?.[0];
    expect(forwardedError).toBeInstanceOf(AppError);
    expect((forwardedError as AppError).statusCode).toBe(403);
  });

  it("allows a must-change-password user to reach the allowlisted change-password route", async () => {
    const token = signAccessToken({ id: "user-1", mustChangePassword: true });
    const req = makeReq({
      cookies: { accessToken: token },
      originalUrl: "/api/auth/change-password",
    });
    const res = makeRes();
    const next = vi.fn();

    await authMiddleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user).toBeDefined();
  });

  it("allows a must-change-password user to reach an allowlisted route with a query string", async () => {
    const token = signAccessToken({ id: "user-1", mustChangePassword: true });
    const req = makeReq({
      cookies: { accessToken: token },
      originalUrl: "/api/me?foo=bar",
    });
    const res = makeRes();
    const next = vi.fn();

    await authMiddleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });
});
