import { Request, Response } from "express";
import path from "path";
import { readFile } from "fs/promises";
import { decryptDocument } from "./documentEncryption";
import { mimeTypeForExtension } from "./uploadExtension";

const UPLOADS_ROOT = path.join(process.cwd(), "uploads");

// Documents are encrypted at rest (see documentEncryption.ts), so they can no
// longer be handed to express.static - each read now needs a decrypt step.
// This replicates express.static's traversal protection manually since we're
// resolving paths ourselves instead of delegating to it.
export async function serveEncryptedDocument(req: Request, res: Response): Promise<void> {
  await sendEncryptedFile(res, req.path);
}

/**
 * Decrypts and streams one file from the uploads volume.
 *
 * `relativePath` may be either "/billing/x.jpg" (as it arrives on the static
 * route) or a stored DB path like "uploads/settlements/x.jpg" — both resolve
 * under the uploads root, and anything escaping it is rejected.
 *
 * Callers that route around the admin-only /uploads mount are responsible for
 * their own authorization before calling this.
 */
export async function sendEncryptedFile(res: Response, relativePath: string): Promise<void> {
  const withoutPrefix = relativePath.replace(/\\/g, "/").replace(/^\/?uploads\//, "/");
  const requestedPath = path.join(UPLOADS_ROOT, path.normalize(withoutPrefix));
  if (!requestedPath.startsWith(UPLOADS_ROOT + path.sep)) {
    res.status(400).end();
    return;
  }

  try {
    const encrypted = await readFile(requestedPath);
    const decrypted = decryptDocument(encrypted);
    res.setHeader("Content-Type", mimeTypeForExtension(path.extname(requestedPath)));
    res.setHeader("Content-Disposition", "inline");
    res.send(decrypted);
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      res.status(404).end();
      return;
    }
    console.error("[documents] Failed to serve encrypted document:", error);
    res.status(500).end();
  }
}
