import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { AppError } from "../utils/AppError";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatZodErrors(error: ZodError): { field: string; message: string }[] {
  return error.issues.map((issue) => ({
    field: issue.path.join(".") || "root",
    message: issue.message,
  }));
}

/** Duck-type guard for Prisma's PrismaClientKnownRequestError */
function isPrismaKnownError(
  err: unknown,
): err is { code: string; meta?: { target?: string[]; cause?: string } } {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (err as Record<string, unknown>).code === "string" &&
    /^P\d{4}$/.test((err as Record<string, unknown>).code as string)
  );
}

// ── Global error handler ──────────────────────────────────────────────────────

/**
 * Must be registered AFTER all routes in server.ts.
 * Express identifies it as an error handler because it has exactly 4 arguments.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  // 1. Zod validation errors (thrown inside services or caught before validate middleware)
  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: formatZodErrors(err),
    });
    return;
  }

  // 2. Application-level known errors
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
    });
    return;
  }

  // 3. Prisma constraint / not-found errors
  if (isPrismaKnownError(err)) {
    switch (err.code) {
      case "P2002":
        res.status(409).json({
          success: false,
          message: "A record with this value already exists",
          field: err.meta?.target?.join(", "),
        });
        return;

      case "P2025":
        res.status(404).json({
          success: false,
          message: "Record not found",
        });
        return;

      case "P2003":
        res.status(400).json({
          success: false,
          message: "Referenced record does not exist",
        });
        return;

      default:
        console.error("[Unhandled Prisma Error]", err.code, err.meta);
        res.status(400).json({
          success: false,
          message: "Database operation failed",
        });
        return;
    }
  }

  // 4. Unexpected errors — log server-side, never expose internals to the client.
  // Fail safe: only show stack traces when NODE_ENV is explicitly "development",
  // not merely "not production" (an unset/misconfigured NODE_ENV must never
  // default to the verbose/leaky behavior).
  const isDev = process.env.NODE_ENV === "development";

  if (isDev) {
    console.error("[Unhandled Error]", err);
  } else {
    console.error(
      "[Unhandled Error]",
      err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    );
  }

  res.status(500).json({
    success: false,
    message: "Internal server error",
    ...(isDev && err instanceof Error ? { stack: err.stack } : {}),
  });
}
