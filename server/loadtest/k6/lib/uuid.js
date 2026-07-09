// Minimal RFC-4122-shaped v4 UUID generator. Only needs to be unique across
// this test run (used for Idempotency-Key headers), not cryptographically
// random, so plain Math.random keeps this dependency-free (no CDN jslib
// fetch needed for a local load test).
export function uuidv4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
