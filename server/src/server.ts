import express, {Express, Request, Response} from 'express';
import path from 'path';
import {config} from 'dotenv';
import routes from "./routes/auth.routes";
import OrderRoutes from "./routes/order.routes"
import DeliveryRateRoutes from "./routes/delivery-rate.routes"
import TicketRoutes from "./routes/ticket.routes"
import RemarkRoutes from "./routes/remark.routes"
import NotificationRoutes from "./routes/notification.routes"
import FinanceRoutes from "./routes/finance.routes"
import StaffRoutes from "./routes/staff.routes"
import KycRoutes from "./routes/kyc.routes"
import prisma from "./lib/prisma";
import cookiesParser from "cookie-parser";
import {authMiddleware} from "./middlewares/auth.mddleware";


import cors from "cors"

config();

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

app.use("/api/staff", StaffRoutes)

app.use("/api/kyc", KycRoutes)
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")))


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

const updateCurrentUserHandler = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "Unauthorized" });

    const { fullName, phone } = req.body;
    if (!fullName?.trim()) return res.status(400).json({ error: "Full name is required" });

    const updated = await prisma.users.update({
      where: { id: req.user.id },
      data: {
        full_name: fullName.trim(),
        phone: phone?.trim() || null,
        updated_at: new Date(),
      },
    });

    return res.json({
      id: updated.id,
      fullName: updated.full_name,
      email: updated.email,
      phone: updated.phone,
    });
  } catch (error) {
    console.error("Error updating user profile:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

app.patch('/api/me', authMiddleware, updateCurrentUserHandler);

export default app;
