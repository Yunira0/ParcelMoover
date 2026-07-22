import crypto from "crypto";

// Signing secrets for outbound vendor webhooks. Unlike api_keys.key_hash
// (which only ever needs a one-way comparison), the server must reuse this
// secret to compute a fresh HMAC on every delivery — so it's stored
// reversibly (AES-256-GCM) rather than hashed, keyed off a server-side
// master key. It is still only ever displayed to the vendor once, at
// creation/regeneration, matching the api_keys UX.

const SECRET_PREFIX = "whsec_";
const SECRET_RANDOM_BYTES = 24;
const GCM_IV_LENGTH = 12;

function getMasterKey(): Buffer {
  const raw = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("WEBHOOK_SECRET_ENCRYPTION_KEY is not configured");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("WEBHOOK_SECRET_ENCRYPTION_KEY must decode to 32 bytes (openssl rand -base64 32)");
  }
  return key;
}

export function generateWebhookSecret(): string {
  return SECRET_PREFIX + crypto.randomBytes(SECRET_RANDOM_BYTES).toString("hex");
}

// Output layout: base64(iv [12B] || authTag [16B] || ciphertext).
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(GCM_IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", getMasterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decryptSecret(encoded: string): string {
  const buf = Buffer.from(encoded, "base64");
  const iv = buf.subarray(0, GCM_IV_LENGTH);
  const authTag = buf.subarray(GCM_IV_LENGTH, GCM_IV_LENGTH + 16);
  const ciphertext = buf.subarray(GCM_IV_LENGTH + 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", getMasterKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

// Stripe-style signed header: "t=<unix_seconds>,v1=<hex hmac>". Including the
// timestamp in the signed material lets receivers reject stale/replayed
// deliveries instead of just checking the HMAC in isolation.
export function signPayload(secret: string, timestampSeconds: number, rawBody: string): string {
  const signedPayload = `${timestampSeconds}.${rawBody}`;
  const hmac = crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");
  return `t=${timestampSeconds},v1=${hmac}`;
}
