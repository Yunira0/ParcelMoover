import express, {Express, Request, Response} from 'express';
import {config} from 'dotenv';
import routes from "./routes/auth.routes";
import OrderRoutes from "./routes/order.routes"
import prisma from "./lib/prisma";
import cookiesParser from "cookie-parser";

import cors from "cors"

config();

const app: Express = express();
const port = process.env.PORT || 3000;

app.use(cors({
    origin: process.env.ALLOWeD_ORIGINS?.split(",") || ["https://localhost:3000.com"],
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

import {authMiddleware} from "./middlewares/auth.mddleware";

app.get('/me', authMiddleware, async (req: Request, res: Response) => {
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
    return res.json(user);
   } catch(error) {
    console.error("Error fetching user profile:", error);
    return res.status(500).json({ error: "Internal server error" });
   }
});

export default app;