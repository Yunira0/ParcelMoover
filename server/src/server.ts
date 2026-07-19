import express, {Express} from 'express';
import path from 'path';
import helmet from 'helmet';
import {config} from 'dotenv';
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import routes from "./routes/auth.routes";
import OrderRoutes from "./routes/order.routes"
import DeliveryRateRoutes from "./routes/delivery-rate.routes"
import TicketRoutes from "./routes/ticket.routes"
import RemarkRoutes from "./routes/remark.routes"
import NotificationRoutes from "./routes/notification.routes"
import FinanceRoutes from "./routes/finance.routes"
import StaffRoutes from "./routes/staff.routes"
import KycRoutes from "./routes/kyc.routes"
import LocationRoutes from "./routes/location.routes"
import PricingRoutes from "./routes/pricing.routes"
import SlaRoutes from "./routes/sla.routes"
import NcmRoutes from "./routes/ncm.routes"
import ApiKeyRoutes from "./routes/apiKey.routes"
import PublicApiRoutes from "./routes/publicApi.routes"
import MeRoutes from "./routes/me.routes"
import AuditLogRoutes from "./routes/auditLog.routes"
import prisma, { pool } from "./lib/prisma";
import cookiesParser from "cookie-parser";
import {authMiddleware} from "./middlewares/auth.middleware";
import { errorHandler } from "./middlewares/errorHandler.middleware";
import { requestId } from "./middlewares/requestId.middleware";
import {authorizeRoles} from "./middlewares/authorizeRoles.middleware";
import { createRedisRateLimitStore } from "./lib/rateLimitStore";
import { serveEncryptedDocument } from "./lib/serveEncryptedDocument";


import cors from "cors"

config();

// Validate critical environment variables
if (!process.env.JWT_SECRET) {
  console.error('🔴 FATAL: JWT_SECRET environment variable is not set');
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('🔴 FATAL: DATABASE_URL environment variable is not set');
  process.exit(1);
}

if (!process.env.CSRF_SECRET) {
  console.error('🔴 FATAL: CSRF_SECRET environment variable is not set');
  process.exit(1);
}

if (!process.env.DOCUMENT_ENCRYPTION_KEY) {
  console.error('🔴 FATAL: DOCUMENT_ENCRYPTION_KEY environment variable is not set');
  process.exit(1);
}

const app: Express = express();
const port = process.env.PORT || 3000;

app.use(requestId);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "upgrade-insecure-requests": null,
      "img-src": ["'self'", "data:", "https://images.unsplash.com"],
    },
  },
}));
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(",") || ["http://localhost:5173"],
    credentials: true,
}));
app.use(express.json({ limit: "1mb" }));
app.use(cookiesParser());
app.use(express.static("public"));

// Liveness/readiness probe for load balancers and container orchestration -
// deliberately ahead of rate limiting/auth so it's always fast and unthrottled.
// Checks the database since the app can't do anything useful without it.
app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: "ok" });
  } catch (error) {
    console.error("[Health] Database check failed:", error);
    res.status(503).json({ status: "error" });
  }
});

// Baseline defense-in-depth cap applied to every route. Sensitive/write
// routes layer their own stricter, actor-aware limiter on top of this one -
// this just ensures no route is ever left with zero rate limiting at all.
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  message: { success: false, message: "Too many requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisRateLimitStore("global"),
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? "unknown"),
});
app.use(globalLimiter);

// Trust proxy configuration: only enable in production with a known trusted proxy.
// In development, proxy trust is disabled to prevent IP spoofing.
const trustProxy = process.env.TRUST_PROXY === "true" ? true : false;
app.set("trust proxy", trustProxy);

const trustedProxiesEnv = process.env.TRUSTED_PROXIES;
if (trustedProxiesEnv) {
    const trustedProxies = trustedProxiesEnv.split(",").map(ip => ip.trim()).filter(Boolean);
    if (trustedProxies.length > 0) {
        app.set("trust proxy", trustedProxies);
    }
}


app.use("/api/auth", routes);

app.use("/api/orders", OrderRoutes)

app.use("/api/delivery-rates", DeliveryRateRoutes)

app.use("/api/tickets", TicketRoutes)

app.use("/api/remarks", RemarkRoutes)

app.use("/api/notifications", NotificationRoutes)

app.use("/api/finance", FinanceRoutes)

app.use("/api/staff", StaffRoutes)

app.use("/api/kyc", KycRoutes)

app.use("/api/locations", LocationRoutes)

app.use("/api/pricing", PricingRoutes)

app.use("/api/sla", SlaRoutes)

// NCM (Nepal Can Move) 3PL integration — includes the public webhook receiver.
app.use("/api/ncm", NcmRoutes)

// Vendor self-service management of partner API keys (dashboard, JWT-authed).
app.use("/api/api-keys", ApiKeyRoutes)

// Public partner API v1 — external e-commerce integrations, API-key-authed.
app.use("/api/v1", PublicApiRoutes)

// KYC/registration documents (citizenship, PAN, licence, bank docs) contain
// sensitive PII — only staff verifying an account should ever be able to open one.
app.use(
    "/uploads",
    authMiddleware,
    authorizeRoles("super_admin", "admin"),
    // Fire-and-forget: who opened which document is worth recording, but a
    // logging failure must never block staff from viewing a file they're entitled to.
    (req, _res, next) => {
        prisma.audit_logs.create({
            data: {
                actor_id: req.user!.id,
                entity_type: "document",
                action: "VIEW_DOCUMENT",
                new_data: { path: req.path },
                ip_address: req.ip || null,
                user_agent: req.get("user-agent") || null,
            },
        }).catch((err) => console.error("[audit] Failed to log document view:", err));
        next();
    },
    serveEncryptedDocument,
)

app.use("/api/me", MeRoutes);

app.use("/api/audit-logs", AuditLogRoutes)

// SPA fallback — client-side routes like /dashboard, /vendors, /tickets have
// no matching Express route or file under public/, so without this they 404
// on direct navigation or a hard refresh (React Router only owns them once
// the JS bundle has loaded). Skips /api and /uploads so those keep returning
// real 404s/errors instead of the app shell.
app.use((req, res, next) => {
  if (req.method !== "GET" || req.path.startsWith("/api") || req.path.startsWith("/uploads")) {
    return next();
  }
  // A path with a file extension is a missing static asset — typically a
  // hashed JS/CSS chunk from a previous deploy that an open tab still
  // references — not a client-side route. Answering it with index.html makes
  // the browser fail with "'text/html' is not a valid JavaScript MIME type";
  // a clean 404 lets the client detect the stale deploy and recover.
  if (path.extname(req.path) !== "") {
    return res.status(404).end();
  }
  res.sendFile("index.html", { root: "public" });
});

// Global error handler — must be last
app.use(errorHandler);

const shutdown = async () => {
  console.log("[Server] Shutting down...");
  await prisma.$disconnect();
  await pool.end();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

export default app;
