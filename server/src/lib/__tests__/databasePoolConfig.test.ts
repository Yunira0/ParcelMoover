import { describe, expect, it } from "vitest";
import { readDatabasePoolConfig } from "../databasePoolConfig";

describe("database pool configuration", () => {
  it("preserves existing defaults and supports a deployment connection budget", () => {
    expect(readDatabasePoolConfig({})).toEqual({ max: 60, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000, idleInTransactionTimeoutMs: 30000 });
    expect(readDatabasePoolConfig({ DB_POOL_MAX: "20", DB_APP_PROCESSES: "3", DB_CONNECTION_BUDGET: "60" }).max).toBe(20);
    expect(readDatabasePoolConfig({ DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: "0" }).idleInTransactionTimeoutMs).toBe(0);
  });
  it.each(["0", "-1", "NaN", "10.5", "1e3", "2147483648"])("rejects invalid pool size %s before accepting traffic", (value) => {
    expect(() => readDatabasePoolConfig({ DB_POOL_MAX: value })).toThrow("DB_POOL_MAX");
  });
  it("rejects oversubscribed or incomplete deployment budgets", () => {
    expect(() => readDatabasePoolConfig({ DB_POOL_MAX: "30", DB_APP_PROCESSES: "3", DB_CONNECTION_BUDGET: "80" })).toThrow("exceeds");
    expect(() => readDatabasePoolConfig({ DB_APP_PROCESSES: "2" })).toThrow("set together");
    expect(() => readDatabasePoolConfig({ DB_CONNECTION_BUDGET: "80" })).toThrow("set together");
  });
});
