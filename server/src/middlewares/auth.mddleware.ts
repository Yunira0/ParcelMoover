import { NextFunction, Request, Response } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import prisma from '../lib/prisma';
import { AppError } from '../utils/AppError';


interface AuthTokenPayload extends JwtPayload {
    id: string;
}

declare global {
    namespace Express {
        interface Request {
            user?: {
                id: string;
                fullName: string;
                email: string | null;
                phone: string | null;
                status: string;
                roles: string[];
            }
        }
    }
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
    try {
        const authHeader = req.headers.authorization;
        
        // if (!authHeader || !authHeader.startsWith('Bearer ')) {
        //     throw new AppError(401, 'Authorization header missing or malformed');
        // }

        const token = req.cookies.accessToken;

        if (!token) {
            throw new AppError(401, 'Authentication required');
        }

        if(!process.env.JWT_SECRET) {
            throw new AppError(500, 'JWT secret not configured');
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET) as AuthTokenPayload;

        if (!decoded) {
            throw new AppError(401, 'Invalid token');
        }

        const user = await prisma.users.findFirst({
            where: {
                id: decoded.id,
                deleted_at: null,
                status: 'active',
            },
            include: {
                user_roles: {
                    include: {
                        roles: true,
                    },
                },
            },
        })

        if (!user) {
            throw new AppError(401, 'User not found or inactive');
        }

        req.user = {
            id: user.id,
            fullName: user.full_name,
            email: user.email,
            phone: user.phone,
            status: user.status,
            roles: user.user_roles.map(ur => ur.roles.code),
        };

        next();
    } catch (error) {
        return res.status(401).json({
            success: false,
            message: "Unauthorized"
        })
    }
}
