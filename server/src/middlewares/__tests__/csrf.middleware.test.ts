import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import jwt from "jsonwebtoken";
import type { Request, Response } from "express";
import { csrfProtection } from "../csrf.middleware";
import { ACCESS_TOKEN_AUDIENCE, CSRF_TOKEN_AUDIENCE, JWT_ISSUER } from "../../utils/jwtConfig";

const CSRF_SECRET = "test-csrf-secret";
const JWT_SECRET = "test-jwt-secret";

function signCsrfToken(sub: string) {
  return jwt.sign({ sub }, CSRF_SECRET, { issuer: JWT_ISSUER, audience: CSRF_TOKEN_AUDIENCE });
}

function signAccessToken(id: string) {
  return jwt.sign({ id }, JWT_SECRET, { issuer: JWT_ISSUER, audience: ACCESS_TOKEN_AUDIENCE });
}

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
    method: "POST",
    headers: {},
    cookies: {},
    ...overrides,
  } as unknown as Request;
}

describe("csrfProtection", () => {
  const originalCsrfSecret = process.env.CSRF_SECRET;
  const originalJwtSecret = process.env.JWT_SECRET;

  beforeEach(() => {
    process.env.CSRF_SECRET = CSRF_SECRET;
    process.env.JWT_SECRET = JWT_SECRET;
  });

  afterEach(() => {
    process.env.CSRF_SECRET = originalCsrfSecret;
    process.env.JWT_SECRET = originalJwtSecret;
    vi.restoreAllMocks();
  });

  it("passes through safe methods without checking cookies", () => {
    const next = vi.fn();
    const req = makeReq({ method: "GET" });
    const res = makeRes();

    csrfProtection(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("bypasses the check for Bearer-authenticated requests", () => {
    const next = vi.fn();
    const req = makeReq({
      method: "POST",
      headers: { authorization: "Bearer some.jwt.token" },
    });
    const res = makeRes();

    csrfProtection(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("rejects with 403 when the csrf cookie or header is missing", () => {
    const next = vi.fn();
    const req = makeReq({ cookies: { csrfToken: "abc" }, headers: {} });
    const res = makeRes();

    csrfProtection(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.body).toMatchObject({ success: false, message: "Invalid CSRF Token" });
  });

  it("rejects with 403 when the cookie and header don't match", () => {
    const next = vi.fn();
    const req = makeReq({
      cookies: { csrfToken: "token-a" },
      headers: { "x-csrf-token": "token-b" },
    });
    const res = makeRes();

    csrfProtection(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.body).toMatchObject({ success: false, message: "Invalid CSRF Token" });
  });

  it("rejects with 403 when the csrf token is not a valid JWT", () => {
    const next = vi.fn();
    const req = makeReq({
      cookies: { csrfToken: "not-a-jwt", accessToken: "irrelevant" },
      headers: { "x-csrf-token": "not-a-jwt" },
    });
    const res = makeRes();

    csrfProtection(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.body).toMatchObject({ success: false, message: "Invalid or expired Token" });
  });

  it("rejects with 403 when the access token cookie is missing", () => {
    const csrfToken = signCsrfToken("user-1");
    const next = vi.fn();
    const req = makeReq({
      cookies: { csrfToken },
      headers: { "x-csrf-token": csrfToken },
    });
    const res = makeRes();

    csrfProtection(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.body).toMatchObject({ success: false, message: "Access token missing" });
  });

  it("rejects with 403 when the csrf token and access token belong to different users", () => {
    const csrfToken = signCsrfToken("user-1");
    const accessToken = signAccessToken("user-2");
    const next = vi.fn();
    const req = makeReq({
      cookies: { csrfToken, accessToken },
      headers: { "x-csrf-token": csrfToken },
    });
    const res = makeRes();

    csrfProtection(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.body).toMatchObject({ success: false, message: "CSRF Token Mismatch" });
  });

  it("calls next() when the csrf token and access token match the same user", () => {
    const csrfToken = signCsrfToken("user-1");
    const accessToken = signAccessToken("user-1");
    const next = vi.fn();
    const req = makeReq({
      cookies: { csrfToken, accessToken },
      headers: { "x-csrf-token": csrfToken },
    });
    const res = makeRes();

    csrfProtection(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("handles a duplicated x-csrf-token header (array) by using the first value", () => {
    const csrfToken = signCsrfToken("user-1");
    const accessToken = signAccessToken("user-1");
    const next = vi.fn();
    const req = makeReq({
      cookies: { csrfToken, accessToken },
      headers: { "x-csrf-token": [csrfToken, "other"] },
    });
    const res = makeRes();

    csrfProtection(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it("rejects a csrf token signed with the wrong audience (e.g. an access token reused as a csrf token)", () => {
    // Signed with the CSRF secret but the access-token audience — simulates a
    // token-confusion attempt, which the distinct audience claim must block.
    const wrongAudienceToken = jwt.sign({ sub: "user-1" }, CSRF_SECRET, {
      issuer: JWT_ISSUER,
      audience: ACCESS_TOKEN_AUDIENCE,
    });
    const accessToken = signAccessToken("user-1");
    const next = vi.fn();
    const req = makeReq({
      cookies: { csrfToken: wrongAudienceToken, accessToken },
      headers: { "x-csrf-token": wrongAudienceToken },
    });
    const res = makeRes();

    csrfProtection(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.body).toMatchObject({ success: false, message: "Invalid or expired Token" });
  });
});
