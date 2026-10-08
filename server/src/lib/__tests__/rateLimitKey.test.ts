import type { Request } from "express";
import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import { createGlobalRateLimitKeyGenerator } from "../rateLimitKey";
import { ACCESS_TOKEN_AUDIENCE, JWT_ISSUER } from "../../utils/jwtConfig";

const secret = "test-rate-limit-secret";
const keyFor = createGlobalRateLimitKeyGenerator(secret);

function tokenFor(id: string, signingSecret = secret) {
  return jwt.sign({ id }, signingSecret, {
    algorithm: "HS256",
    issuer: JWT_ISSUER,
    audience: ACCESS_TOKEN_AUDIENCE,
    expiresIn: "1h",
  });
}

function request(overrides: Partial<Request>): Request {
  return {
    headers: {},
    cookies: {},
    ip: "203.0.113.10",
    ...overrides,
  } as Request;
}

describe("createGlobalRateLimitKeyGenerator", () => {
  it("gives signed-in users separate buckets even when they share an IP", () => {
    const first = keyFor(request({ cookies: { accessToken: tokenFor("user-1") } }));
    const second = keyFor(request({ cookies: { accessToken: tokenFor("user-2") } }));

    expect(first).toBe("actor:user-1");
    expect(second).toBe("actor:user-2");
  });

  it("supports the bearer token used by non-cookie clients", () => {
    const token = tokenFor("mobile-user");
    const key = keyFor(request({ headers: { authorization: `Bearer ${token}` } }));

    expect(key).toBe("actor:mobile-user");
  });

  it("keeps anonymous and forged-token traffic in the IP bucket", () => {
    const anonymous = keyFor(request({ ip: "198.51.100.20" }));
    const forged = keyFor(request({
      ip: "198.51.100.20",
      cookies: { accessToken: tokenFor("forged-user", "wrong-secret") },
    }));

    expect(anonymous).toBe(forged);
    expect(anonymous).toMatch(/^ip:/);
  });
});
