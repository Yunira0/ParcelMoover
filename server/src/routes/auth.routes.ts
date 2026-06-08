import {Router} from 'express';
import { login, registerUserController} from '../controllers/auth.controller';
import {authMiddleware} from '../middlewares/auth.mddleware';
import { csrfProtection } from '../middlewares/csrf.middleware';

const authRouter: Router = Router();

authRouter.post("/login", login);
authRouter.post("/users/register", authMiddleware, csrfProtection, registerUserController);

export default authRouter;