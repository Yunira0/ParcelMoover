import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const serverPackage = JSON.parse(
  readFileSync(resolve(__dirname, "../../../package.json"), "utf8"),
) as { scripts?: Record<string, string> };
const dockerfile = readFileSync(resolve(__dirname, "../../../../Dockerfile"), "utf8");
const deploymentWorkflow = readFileSync(
  resolve(__dirname, "../../../../.github/workflows/deployment.yml"),
  "utf8",
);

describe("production startup", () => {
  it("delegates the container entrypoint to the canonical server start script", () => {
    expect(dockerfile).toContain('CMD ["npm", "start"]');
  });

  it("runs the delivered-order diagnostic and carrier backfill before starting the server", () => {
    const start = serverPackage.scripts?.start ?? "";
    const diagnosticIndex = start.indexOf("dist/scripts/diagnose-unsettled-gap.js");
    const backfillIndex = start.indexOf("dist/scripts/backfill-carrier-delivered-collected-at.js --commit --once");
    const serverIndex = start.lastIndexOf("node dist/index.js");

    expect(diagnosticIndex).toBeGreaterThanOrEqual(0);
    expect(backfillIndex).toBeGreaterThan(diagnosticIndex);
    expect(serverIndex).toBeGreaterThan(backfillIndex);
  });

  it("allows one-time production repairs to finish before rolling back", () => {
    expect(deploymentWorkflow).toContain("Health check (retry up to 5m)");
    expect(deploymentWorkflow).toContain("for i in $(seq 1 60)");
  });
});
