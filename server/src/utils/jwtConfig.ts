// Shared JWT claims — used by every sign()/verify() call so they can never
// drift out of sync (a mismatch here would break all authentication).
export const JWT_ALGORITHM = "HS256" as const;
export const JWT_ISSUER = "parcelmoover-api";

// Distinct audiences per token type: even though the access token and CSRF
// token already use separate secrets (JWT_SECRET vs CSRF_SECRET), pinning a
// distinct audience is a second, independent layer of defense against token
// confusion if secrets were ever accidentally shared or reused.
export const ACCESS_TOKEN_AUDIENCE = "parcelmoover-access";
export const CSRF_TOKEN_AUDIENCE = "parcelmoover-csrf";
