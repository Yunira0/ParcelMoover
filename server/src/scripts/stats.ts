// pm-stats: ParcelMoover numbers in the terminal. Read-only; safe against
// production. Guide: docs/MONITORING.md.
//
// On the EC2 host:  pm-stats users          (deploy/pm-stats wrapper)
// Locally:          npx ts-node --transpile-only src/scripts/stats.ts users
import "dotenv/config";
import { parseArgs } from "node:util";
import Redis from "ioredis";
import prisma from "../lib/prisma";
import { API_WINDOWS, type ApiWindow } from "../services/analytics/queries/api";
import { apiCommand } from "./stats/commands/api";
import { businessCommand } from "./stats/commands/business";
import { liveCommand } from "./stats/commands/live";
import { vendorsCommand } from "./stats/commands/vendors";
import { ridersCommand } from "./stats/commands/riders";
import { MAX_DAYS, usersCommand } from "./stats/commands/users";
import { helpText } from "./stats/help";
import { configureColor } from "./stats/render";

// Our own quiet connection: the server's shared client logs to stdout, which
// would corrupt --json output. Fails fast instead of retrying forever.
let redis: Redis | null = null;
function getRedis(): Redis {
  if (!redis) {
    redis = new Redis({
      host: process.env.REDIS_HOST || "localhost",
      port: Number(process.env.REDIS_PORT || 6379),
      db: Number(process.env.REDIS_DB || 0),
      lazyConnect: true,
      connectTimeout: 3000,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    redis.on("error", () => {});
  }
  return redis;
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      days: { type: "string" },
      outdated: { type: "boolean", default: false },
      last: { type: "string", default: "1h" },
      all: { type: "boolean", default: false },
      branch: { type: "string" },
      json: { type: "boolean", default: false },
      "no-color": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  const command = positionals[0];
  if (!command || values.help) {
    configureColor(!values["no-color"] && !process.env.NO_COLOR && Boolean(process.stdout.isTTY));
    console.log(helpText());
    return 0;
  }

  const days = values.days === undefined ? 30 : Number(values.days);
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    console.error(`--days must be a whole number from 1 to ${MAX_DAYS}`);
    return 1;
  }

  if (!(values.last in API_WINDOWS)) {
    console.error("--last must be one of 1h, 24h, 7d");
    return 1;
  }
  const window = values.last as ApiWindow;

  configureColor(!values.json && !values["no-color"] && !process.env.NO_COLOR && Boolean(process.stdout.isTTY));

  switch (command) {
    case "users":
      console.log(await usersCommand({ json: values.json, days }));
      return 0;
    case "riders":
      console.log(await ridersCommand({ json: values.json, outdated: values.outdated }));
      return 0;
    case "api":
      console.log(await apiCommand(getRedis(), { json: values.json, window }));
      return 0;
    case "vendors":
      console.log(await vendorsCommand(getRedis(), { json: values.json, all: values.all }));
      return 0;
    case "business":
      console.log(await businessCommand({ json: values.json, branch: values.branch?.trim() || null }));
      return 0;
    case "live":
      if (values.json) {
        console.error("live has no --json; use the other commands for scripts");
        return 1;
      }
      await liveCommand(getRedis());
      return 0;
    default:
      console.error(`Unknown command "${command}". Run pm-stats --help to see the commands.`);
      return 1;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    redis?.disconnect();
    return prisma.$disconnect();
  });
