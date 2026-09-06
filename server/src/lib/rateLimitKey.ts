import type { Request } from "express";
import { ipKeyGenerator } from "express-rate-limit";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { ACCESS_TOKEN_AUDIENCE, JWT_ISSUER } from "../utils/jwtConfig";

interface ActorTokenPayload extends JwtPayload {
  id?: unknown;
}

/**
 * Partition the broad, application-wide safety limit by signed-in actor.
 *
 * The global limiter runs before route authentication, so req.user is not
 * populated yet. Verifying the existing access token here prevents hundreds
 * of legitimate users behind Cloudflare, a carrier-grade NAT, or an office
 * network from consuming one shared IP bucket. Anonymous and invalid-token
 * traffic stays IP-limited.
 */
export function createGlobalRateLimitKeyGenerator(jwtSecret: string) {
  return (req: Request): string => {
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    const token = bearerToken ?? req.cookies?.accessToken;

    if (token) {
      try {
        const decoded = jwt.verify(token, jwtSecret, {
          algorithms: ["HS256"],
          issuer: JWT_ISSUER,
          audience: ACCESS_TOKEN_AUDIENCE,
        }) as ActorTokenPayload;

        if (typeof decoded.id === "string" && decoded.id.length > 0) {
          return `actor:${decoded.id}`;
        }
      } catch {
        // Route authentication will return the appropriate 401. For this
        // defense-in-depth limiter, an invalid token simply remains IP-bound.
      }
    }

    return `ip:${ipKeyGenerator(req.ip ?? "unknown")}`;
  };
}
