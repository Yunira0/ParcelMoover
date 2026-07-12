import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// KYC/registration documents (citizenship, PAN, licence, bank docs) are
// encrypted at rest with this key so a filesystem/volume compromise alone
// doesn't expose them - the app is still the only thing that can read them.
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const keyHex = process.env.DOCUMENT_ENCRYPTION_KEY;
  if (!keyHex) {
    throw new Error("DOCUMENT_ENCRYPTION_KEY environment variable is not set");
  }
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== 32) {
    throw new Error("DOCUMENT_ENCRYPTION_KEY must be 32 bytes, hex-encoded (64 hex characters)");
  }
  return key;
}

// Output layout: [iv (12 bytes)][authTag (16 bytes)][ciphertext]
export function encryptDocument(plaintext: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]);
}

export function decryptDocument(payload: Buffer): Buffer {
  if (payload.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Encrypted document payload is truncated or corrupt");
  }
  const iv = payload.subarray(0, IV_LENGTH);
  const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = payload.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
