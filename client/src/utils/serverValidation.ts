// The API's Zod validate middleware rejects bad payloads with
// { message: "Validation failed", errors: [{ field, message }] }.
// Registration/edit forms use these helpers to surface those per-field
// messages inline instead of a generic "Validation failed" banner, and to
// mirror the server's phone/email format rules before submitting.

/** Nepali mobile number: 10 digits starting 97/98 (Ncell/NTC/Smart), with an
 *  optional +977 / 977 country code. Matches the server's phoneSchema
 *  (server/src/validators/common.ts). */
export const PHONE_RE = /^(?:\+?977)?9[78]\d{8}$/;

/** Trim surrounding whitespace before sending. Internal separators are NOT
 *  stripped - a number with spaces/dashes is rejected by isValidPhone instead. */
export function normalizePhone(value: string): string {
  return value.trim();
}

// Validate the number as typed (trimmed only): spaces, dashes or any other
// character make it invalid, so the user is asked for a clean mobile number.
export function isValidPhone(value: string): boolean {
  return PHONE_RE.test(value.trim());
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

/**
 * Map the API's validation errors onto form field names.
 * `fieldMap` translates API field → form field; unmapped fields pass through
 * unchanged. Returns null when the response carries no field errors (so
 * callers can fall back to the response's plain message).
 */
export function extractServerFieldErrors(
  err: unknown,
  fieldMap: Record<string, string> = {},
): { fieldErrors: Record<string, string>; summary: string } | null {
  const issues = (err as { response?: { data?: { errors?: unknown } } })?.response?.data?.errors;
  if (!Array.isArray(issues) || issues.length === 0) return null;

  const fieldErrors: Record<string, string> = {};
  const messages: string[] = [];
  for (const issue of issues) {
    if (typeof issue?.message !== 'string') continue;
    const apiField = typeof issue.field === 'string' ? issue.field : 'root';
    const formField = fieldMap[apiField] ?? apiField;
    // Keep the first message per field — e.g. fullName and clientName both map
    // to ownerName, and the first carries the friendlier wording.
    if (!(formField in fieldErrors)) {
      fieldErrors[formField] = issue.message;
      messages.push(issue.message);
    }
  }
  if (messages.length === 0) return null;
  return { fieldErrors, summary: messages.join(' · ') };
}
