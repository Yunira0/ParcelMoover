import { Request, Response, NextFunction } from "express";

/**
 * Revives JSON-encoded fields on a multipart body.
 *
 * Once a route accepts file uploads the client must send multipart/form-data,
 * where every field arrives as a string — so a structured field like
 * `payments: [{ method, amount }]` reaches the zod schema as a string and fails
 * validation. This parses the named fields back into objects before `validate`
 * runs. JSON requests are untouched (the values are already parsed), so a route
 * can accept both shapes.
 */
export function parseMultipartJson(...fields: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    for (const field of fields) {
      const value = req.body?.[field];
      if (typeof value !== "string") continue;
      try {
        req.body[field] = JSON.parse(value);
      } catch {
        // Leave the raw string in place - the schema will reject it with a
        // field-specific message, which beats a generic "invalid JSON" here.
      }
    }
    next();
  };
}
