import express, {Express, Request, Response} from 'express';
import {config} from 'dotenv';
import routes from "./routes/auth.routes";
import OrderRoutes from "./routes/order.routes"
import DeliveryRateRoutes from "./routes/delivery-rate.routes"
import TicketRoutes from "./routes/ticket.routes"
import RemarkRoutes from "./routes/remark.routes"
import NotificationRoutes from "./routes/notification.routes"
import FinanceRoutes from "./routes/finance.routes"
import prisma from "./lib/prisma";
import redis from "./lib/redis";
import cookiesParser from "cookie-parser";
import {authMiddleware} from "./middlewares/auth.mddleware";
import { errorHandler } from "./middlewares/errorHandler.middleware";


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

const app: Express = express();
const port = process.env.PORT || 3000;

app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(",") || ["http://localhost:5173"],
    credentials: true,
}));
app.use(express.json());
app.use(cookiesParser());

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


const getCurrentUserHandler = async (req: Request, res: Response) => {
   try{
     if(!req.user?.id) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    const user = await prisma.users.findUnique({
        where: { id: req.user?.id },
        include: { user_roles: { include: { roles: true } } },
    });
    if(!user) {
        return res.status(404).json({ error: "User not found" });
    }
    return res.json({
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        phone: user.phone,
        status: user.status,
        roles: user.user_roles.map(userRole => userRole.roles.code),
    });
   } catch(error) {
    console.error("Error fetching user profile:", error);
    return res.status(500).json({ error: "Internal server error" });
   }
};

app.get('/me', authMiddleware, getCurrentUserHandler);
app.get('/api/me', authMiddleware, getCurrentUserHandler);

// Global error handler — must be last
app.use(errorHandler);

export default app;
