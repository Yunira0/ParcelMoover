import { NextFunction, Request, Response } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import prisma from '../lib/prisma';
import { AppError } from '../utils/AppError';
import { isIssuedBeforeUserRevocation, isTokenRevoked } from '../lib/tokenRevocation';


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
                mustChangePassword: boolean;
            }
        }
    }
}

// Endpoints a user with a pending forced password change may still hit -
// changing the password itself, logging out, and reading (not editing) their
// own profile so the frontend can identify them and show the forced screen.
function isPasswordChangeBypass(req: Request): boolean {
    if (req.originalUrl.startsWith("/api/auth/change-password") || req.originalUrl.startsWith("/api/auth/logout")) {
        return true;
    }
    if ((req.originalUrl === "/me" || req.originalUrl === "/api/me") && req.method === "GET") {
        return true;
    }
    return false;
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
    try {
        const authHeader = req.headers.authorization;
        const token = (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null)
            ?? req.cookies.accessToken;

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

        const [revoked, revokedByUserWide] = await Promise.all([
            isTokenRevoked(decoded.jti),
            isIssuedBeforeUserRevocation(decoded.id, decoded.iat),
        ]);
        if (revoked || revokedByUserWide) {
            throw new AppError(401, 'Session has been revoked, please log in again');
        }

        const user = await prisma.users.findFirst({
            where: {
                id: decoded.id,
                deleted_at: null,
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

        // Deactivated accounts get a coded 401 so clients (rider PWA) can show
        // a dedicated "account deactivated" screen instead of a generic logout.
        if (user.status !== 'active') {
            throw new AppError(401, 'Your account has been deactivated', 'ACCOUNT_INACTIVE');
        }

        if (user.must_change_password && !isPasswordChangeBypass(req)) {
            throw new AppError(403, 'Password change required before continuing');
        }

        req.user = {
            id: user.id,
            fullName: user.full_name,
            email: user.email,
            phone: user.phone,
            status: user.status,
            roles: user.user_roles.map(ur => ur.roles.code),
            mustChangePassword: user.must_change_password,
        };

        next();
    } catch (error) {
        if (error instanceof AppError && error.statusCode === 403) {
            return res.status(403).json({ success: false, message: error.message });
        }
        if (error instanceof AppError && error.code) {
            return res.status(401).json({ success: false, message: error.message, code: error.code });
        }
        return res.status(401).json({
            success: false,
            message: "Unauthorized"
        })
    }
}
