import express from "express";
import type { Express } from "express";
import { unlink } from "fs/promises";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { registrationUpload } from "../registrationUpload";
import { errorHandler } from "../../middlewares/errorHandler.middleware";

const limit = 5 * 1024 * 1024;
const createdPaths: string[] = [];

function app(): Express {
  const server = express();
  const accepted: express.RequestHandler = (req, res) => {
    const files = Object.values(req.files as Record<string, Express.Multer.File[]>).flat();
    createdPaths.push(...files.map((file) => file.path));
    res.json({ success: true, sizes: files.map((file) => file.size) });
  };
  server.post("/register", registrationUpload, accepted);
  server.patch("/users/:type/:id", registrationUpload, accepted);
  server.use(errorHandler);
  return server;
}

afterEach(async () => {
  await Promise.all(createdPaths.splice(0).map((file) => unlink(file)));
});

describe("staff admin registration upload errors", () => {
  it.each([
    ["citizenshipDoc", "Citizenship document"],
    ["idDocument", "National ID document"],
    ["panDoc", "PAN document"],
  ])("names the oversized %s field and does not proceed", async (field, label) => {
    const response = await request(app()).post("/register")
      .field("type", "admin")
      .attach(field, Buffer.alloc(limit + 1), { filename: "oversized.pdf", contentType: "application/pdf" });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      success: false,
      code: "FILE_TOO_LARGE",
      errors: [{ field, message: `${label} exceeds the 5 MB limit. Compress the file or choose a smaller one.` }],
    });
    expect(createdPaths).toHaveLength(0);
  });

  it("continues to accept a document just below the existing limit", async () => {
    const response = await request(app()).post("/register")
      .field("type", "admin")
      .attach("idDocument", Buffer.alloc(limit - 1), { filename: "below-limit.pdf", contentType: "application/pdf" });
    expect(response.status).toBe(200);
    expect(response.body.sizes).toEqual([limit - 1]);
  });

  it("matches the parser's existing rejection exactly at the threshold", async () => {
    const response = await request(app()).post("/register")
      .field("type", "admin")
      .attach("idDocument", Buffer.alloc(limit), { filename: "at-limit.pdf", contentType: "application/pdf" });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("FILE_TOO_LARGE");
  });

  it("recognizes admin profile uploads using the route type", async () => {
    const response = await request(app()).patch("/users/admin/example")
      .attach("idDocument", Buffer.alloc(limit + 1), { filename: "oversized.pdf", contentType: "application/pdf" });
    expect(response.body.code).toBe("FILE_TOO_LARGE");
    expect(response.body.errors[0].field).toBe("idDocument");
  });

  it.each(["vendor", "rider"])("preserves the existing %s upload error contract", async (type) => {
    const response = await request(app()).post("/register")
      .field("type", type)
      .attach("citizenshipDoc", Buffer.alloc(limit + 1), { filename: "oversized.pdf", contentType: "application/pdf" });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ success: false, message: "That file is too large. Please upload a smaller one." });
  });
});
