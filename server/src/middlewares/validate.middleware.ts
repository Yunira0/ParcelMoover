import { Request, Response, NextFunction } from "express";
import { ZodSchema, ZodError } from "zod";

type ValidationSource = "body" | "query" | "params";

function formatZodErrors(error: ZodError): { field: string; message: string }[] {
  // Zod v4 uses .issues (aliased as .errors); handle both for safety
  const issues = (error as any).issues ?? (error as any).errors ?? [];
  return issues.map((issue: any) => ({
    field: Array.isArray(issue.path) ? issue.path.join(".") || "root" : "root",
    message: typeof issue.message === "string" ? issue.message : "Validation error",
  }));
}

export function validate(schema: ZodSchema, source: ValidationSource = "body") {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: formatZodErrors(result.error),
      });
      return;
    }

    if (source === "body") {
      req.body = result.data;
    } else {
      Object.defineProperty(req, source, {
        value: result.data,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
    next();
  };
}
