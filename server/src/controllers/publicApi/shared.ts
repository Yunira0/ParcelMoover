import { Request } from "express";

// Every public API handler synthesizes a vendor OrderActor from the
// authenticated API key, so the existing vendor-scoped services enforce
// ownership exactly as they do for dashboard logins.
export function actorFrom(req: Request) {
  return { id: req.apiKey!.userId, roles: ["vendor"] };
}

export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Re-exported so existing `from "./shared"` imports across the public API
// controllers keep working; the implementation lives in utils/errorResponse.ts
// so non-/api/v1 surfaces (e.g. the webhook management controller) can use
// the same structured error envelope without importing from controllers/publicApi.
export { sendError } from "../../utils/errorResponse";
