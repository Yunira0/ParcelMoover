import { Response, Request } from "express";

// Every public API handler synthesizes a vendor OrderActor from the
// authenticated API key, so the existing vendor-scoped services enforce
// ownership exactly as they do for dashboard logins.
export function actorFrom(req: Request) {
  return { id: req.apiKey!.userId, roles: ["vendor"] };
}

export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS_CODE_TO_ERROR_CODE: Record<number, string> = {
  400: "VALIDATION_ERROR",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  422: "VALIDATION_ERROR",
  429: "RATE_LIMITED",
  500: "INTERNAL_ERROR",
};

// Every /api/v1 handler's catch block ends here - keeps the existing
// {success, message} shape every current integration already reads, while
// additively attaching a stable, machine-readable error.code so new
// integrations can branch on the failure type instead of parsing message text.
export function sendError(res: Response, error: any, fallbackMessage: string) {
  const statusCode = error?.statusCode || 500;
  const code = error?.code || STATUS_CODE_TO_ERROR_CODE[statusCode] || "INTERNAL_ERROR";
  return res.status(statusCode).json({
    success: false,
    message: error?.message || fallbackMessage,
    error: { code },
  });
}
