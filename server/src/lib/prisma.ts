import "dotenv/config";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { timeDatabaseOperation, setDatabasePoolMetricsProvider } from "./requestPerformance";
import { readDatabasePoolConfig } from "./databasePoolConfig";

// max is per process - if this app ever runs as multiple instances behind a
// load balancer, divide Postgres's max_connections by instance count (minus
// headroom for migrations/admin tools) rather than reusing this value as-is.
const poolConfig = readDatabasePoolConfig(process.env);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: poolConfig.max,
  idleTimeoutMillis: poolConfig.idleTimeoutMillis,
  connectionTimeoutMillis: poolConfig.connectionTimeoutMillis,
  // Send this in the PostgreSQL startup packet, before the connection can be
  // checked out. An async "connect" listener races the first Prisma query.
  idle_in_transaction_session_timeout: poolConfig.idleInTransactionTimeoutMs,
});

setDatabasePoolMetricsProvider(() => ({
  max: poolConfig.max, total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount,
}));

pool.on("error", (err) => {
  console.error("[DB] Idle client error:", err.message);
});

const adapter = new PrismaPg(pool);

const baseClient = new PrismaClient({ adapter });
// This query-only extension preserves every model's args/results. Keep the
// existing delegate types used by transaction helpers; extended clients omit
// $on, which is not part of this application's database interface.
const prisma = (process.env.PERFORMANCE_TIMING === "true" ? baseClient.$extends({
  name: "request-performance",
  query: {
    $allOperations({ args, query }) {
      return timeDatabaseOperation(() => query(args));
    },
  },
}) : baseClient) as unknown as Omit<PrismaClient, "$on">;

export { pool };
export default prisma;
