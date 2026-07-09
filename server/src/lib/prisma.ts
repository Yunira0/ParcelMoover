import "dotenv/config";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

// max is per process - if this app ever runs as multiple instances behind a
// load balancer, divide Postgres's max_connections by instance count (minus
// headroom for migrations/admin tools) rather than reusing this value as-is.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX) || 60,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err) => {
  console.error("[DB] Idle client error:", err.message);
});

// Safety net for a request that leaves a transaction open and never commits
// or rolls back (e.g. a client that times out mid-bulk-write while the
// server keeps working) - load testing found extreme write overload could
// leave most of the pool "idle in transaction" for ~1-2 minutes. Postgres
// itself had no timeout guarding against that; this is a backstop, not a fix
// for the underlying handler - a well-behaved transaction should never hit it.
const IDLE_IN_TRANSACTION_TIMEOUT_MS = Number(process.env.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS) || 30_000;
pool.on("connect", (client) => {
  client.query(`SET idle_in_transaction_session_timeout = ${IDLE_IN_TRANSACTION_TIMEOUT_MS}`).catch((err) => {
    console.error("[DB] Failed to set idle_in_transaction_session_timeout:", err.message);
  });
});

const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({ adapter });

export { pool };
export default prisma;
