import { Prisma } from "../generated/prisma/client";
import prisma from "../lib/prisma";
import redis from "../lib/redis";
import { AuditLogsPageMeta, ListAuditLogsParams } from "../types/auditLog.type";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

const FILTER_OPTIONS_CACHE_KEY = "audit-logs:filter-options";
const FILTER_OPTIONS_TTL_SECONDS = 300;

interface AuditLogCursor {
  t: string; // created_at, ISO string
  id: string;
}

function encodeCursor(cursor: AuditLogCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

// Malformed/tampered cursors degrade to "start from the top" rather than 500ing.
function decodeCursor(raw: string | undefined): AuditLogCursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (parsed && typeof parsed.t === "string" && typeof parsed.id === "string") {
      return parsed;
    }
  } catch {
    // fall through
  }
  return null;
}

// Log entries are append-only and strictly time-ordered, so "go back a page"
// never needs a real backward query - the client just replays a cursor it
// already saw. That means this only ever walks forward, which keeps the
// keyset condition (and the index it hits) one-directional and simple.
export async function listAuditLogs(params: ListAuditLogsParams = {}) {
  const where: Prisma.audit_logsWhereInput = {};

  if (params.entityType) where.entity_type = params.entityType;
  if (params.action) where.action = params.action;

  if (params.fromDate || params.toDate) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (params.fromDate) createdAt.gte = new Date(params.fromDate);
    if (params.toDate) createdAt.lte = new Date(params.toDate);
    where.created_at = createdAt;
  }

  // Free-text search is intentionally narrow: only the two short, low-cardinality
  // enum-like text columns, both usable off the existing entity/action indexes.
  // No join to `users` here - a name/email search would force a full scan on
  // every keystroke, which is the one thing this endpoint must never do.
  if (params.search) {
    const q = params.search.trim();
    where.OR = [
      { action: { contains: q, mode: "insensitive" } },
      { entity_type: { contains: q, mode: "insensitive" } },
    ];
  }

  const cursor = decodeCursor(params.cursor);
  if (cursor) {
    const cursorDate = new Date(cursor.t);
    where.AND = [
      {
        OR: [
          { created_at: { lt: cursorDate } },
          { AND: [{ created_at: cursorDate }, { id: { lt: cursor.id } }] },
        ],
      },
    ];
  }

  const take = Math.min(MAX_PAGE_SIZE, Math.max(1, params.pageSize ?? DEFAULT_PAGE_SIZE));

  // Fetch one extra row purely to learn whether another page exists - avoids
  // a separate COUNT(*), which is the expensive part on a table with no
  // natural upper bound on row count.
  const logs = await prisma.audit_logs.findMany({
    where,
    include: { users: { select: { full_name: true, email: true } } },
    orderBy: [{ created_at: "desc" }, { id: "desc" }],
    take: take + 1,
  });

  const hasNextPage = logs.length > take;
  if (hasNextPage) logs.length = take;

  const lastRow = logs[logs.length - 1];
  const meta: AuditLogsPageMeta = {
    pageSize: take,
    hasNextPage,
    nextCursor:
      hasNextPage && lastRow
        ? encodeCursor({ t: lastRow.created_at.toISOString(), id: lastRow.id })
        : null,
  };

  return {
    data: logs.map((log) => ({
      id: log.id,
      actorId: log.actor_id,
      actorName: log.users?.full_name ?? null,
      actorEmail: log.users?.email ?? null,
      entityType: log.entity_type,
      entityId: log.entity_id,
      action: log.action,
      oldData: log.old_data,
      newData: log.new_data,
      ipAddress: log.ip_address,
      userAgent: log.user_agent,
      createdAt: log.created_at,
    })),
    meta,
  };
}

// Rarely-changing (a handful of distinct action/entity_type values that only
// grow when a new feature adds a new audit call site), so it's cached rather
// than run fresh on every System Logs page load.
export async function getAuditLogFilterOptions() {
  try {
    const cached = await redis.get(FILTER_OPTIONS_CACHE_KEY);
    if (cached) return JSON.parse(cached);
  } catch (error) {
    console.error("[Redis] Failed to read audit log filter-options cache:", error);
  }

  const [entityTypes, actions] = await Promise.all([
    prisma.audit_logs.findMany({ distinct: ["entity_type"], select: { entity_type: true } }),
    prisma.audit_logs.findMany({ distinct: ["action"], select: { action: true } }),
  ]);

  const options = {
    entityTypes: entityTypes.map((row) => row.entity_type).sort(),
    actions: actions.map((row) => row.action).sort(),
  };

  try {
    await redis.setex(FILTER_OPTIONS_CACHE_KEY, FILTER_OPTIONS_TTL_SECONDS, JSON.stringify(options));
  } catch (error) {
    console.error("[Redis] Failed to write audit log filter-options cache:", error);
  }

  return options;
}
