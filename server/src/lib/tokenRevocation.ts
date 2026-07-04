import redis from "./redis";

// Two revocation mechanisms, matching what a stateless-JWT app actually needs:
//  - per-token (jti) blacklist for "log this one session out"
//  - per-user "revoke everything issued before now" for "kill every session"
//    (password change, admin-forced deactivation) without having to track
//    every jti ever issued.
// Both are best-effort: a Redis outage means revoked tokens might keep
// working until Redis is back, not that auth stops working entirely -
// consistent with how Redis is treated everywhere else in this app.

const TOKEN_BLACKLIST_PREFIX = "auth:revoked-jti:";
const USER_REVOKE_PREFIX = "auth:revoked-before:";
// Matches the JWT's own expiresIn ("7d") - no point remembering a
// revocation longer than the token it targets could ever be valid for.
const MAX_TOKEN_LIFETIME_SECONDS = 7 * 24 * 60 * 60;

export async function revokeToken(jti: string, expiresAt: number): Promise<void> {
  const ttlSeconds = Math.max(1, expiresAt - Math.floor(Date.now() / 1000));
  try {
    await redis.setex(`${TOKEN_BLACKLIST_PREFIX}${jti}`, ttlSeconds, "1");
  } catch (error) {
    console.error("[Redis] Failed to revoke token:", error);
  }
}

export async function isTokenRevoked(jti: string | undefined): Promise<boolean> {
  if (!jti) return false;
  try {
    return (await redis.exists(`${TOKEN_BLACKLIST_PREFIX}${jti}`)) === 1;
  } catch (error) {
    console.error("[Redis] Failed to check token revocation:", error);
    return false;
  }
}

// Call on password change / forced logout / account deactivation to kill
// every token for a user at once, without needing a session table.
export async function revokeAllUserTokens(userId: string): Promise<void> {
  try {
    await redis.setex(
      `${USER_REVOKE_PREFIX}${userId}`,
      MAX_TOKEN_LIFETIME_SECONDS,
      String(Math.floor(Date.now() / 1000)),
    );
  } catch (error) {
    console.error("[Redis] Failed to revoke user tokens:", error);
  }
}

// True if the token was issued before the user's most recent "revoke everything" call.
export async function isIssuedBeforeUserRevocation(userId: string, issuedAt: number | undefined): Promise<boolean> {
  if (!issuedAt) return false;
  try {
    const revokedBefore = await redis.get(`${USER_REVOKE_PREFIX}${userId}`);
    if (!revokedBefore) return false;
    return issuedAt < Number(revokedBefore);
  } catch (error) {
    console.error("[Redis] Failed to check user-wide token revocation:", error);
    return false;
  }
}
