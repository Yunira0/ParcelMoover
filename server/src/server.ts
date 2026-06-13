import express, {Express, Request, Response} from 'express';
import {config} from 'dotenv';
import routes from "./routes/auth.routes";
import OrderRoutes from "./routes/order.routes"
import prisma from "./lib/prisma";
import cookiesParser from "cookie-parser";

// import cors from "cors";

config();

const app: Express = express();
const port = process.env.PORT || 3000;

// app.use(cors());
app.use(express.json());
app.use(cookiesParser());
// Tell Express to trust the headers passed by your proxy (like X-Forwarded-For)
app.set("trust proxy", 1);


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