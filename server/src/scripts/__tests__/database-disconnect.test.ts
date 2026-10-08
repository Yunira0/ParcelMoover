import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// A query creates an idle pg connection. This child must exit naturally after
// Prisma disconnects, rather than waiting for the pool's 30-second idle timer.
describe.skipIf(!process.env.DATABASE_URL)("startup database cleanup", () => {
  it("releases the external pool and lets CLI processes exit promptly", async () => {
    const result = await new Promise<{ code: number | null; output: string }>((done, reject) => {
      const child = spawn(process.execPath, ["-e", `
        const prisma = require('./dist/lib/prisma').default;
        (async () => {
          try { await prisma.$queryRawUnsafe('SELECT 1'); }
          finally { await prisma.$disconnect(); }
          console.log('disconnected');
        })().catch(error => { console.error(error); process.exitCode = 1; });
      `], { cwd: resolve(__dirname, "../../.."), env: process.env });
      let output = "";
      child.stdout.on("data", data => { output += data; });
      child.stderr.on("data", data => { output += data; });
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error(`Database child did not exit after disconnect: ${output}`));
      }, 5000);
      child.on("error", error => { clearTimeout(timeout); reject(error); });
      child.on("close", code => { clearTimeout(timeout); done({ code, output }); });
    });
    expect(result.output).toContain("disconnected");
    expect(result.code).toBe(0);
  }, 7000);
});
