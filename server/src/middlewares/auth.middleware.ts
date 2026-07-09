import { NextFunction, Request, Response } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import prisma from '../lib/prisma';
import { AppError } from '../utils/AppError';
import { isIssuedBeforeUserRevocation, isTokenRevoked } from '../lib/tokenRevocation';
import { ACCESS_TOKEN_AUDIENCE, JWT_ISSUER } from '../utils/jwtConfig';


interface AuthTokenPayload extends JwtPayload {
    id: string;
    mustChangePassword?: boolean;
}

// When a user must change their password, the only endpoints they may reach are
// the ones needed to complete (or abandon) that flow. Everything else is blocked.
const PASSWORD_CHANGE_ALLOWLIST = new Set<string>([
    "/api/auth/change-password",
    "/api/auth/logout",
    "/api/me",
]);

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

        const decoded = jwt.verify(token, process.env.JWT_SECRET, {
            algorithms: ["HS256"],
            issuer: JWT_ISSUER,
            audience: ACCESS_TOKEN_AUDIENCE,
        }) as AuthTokenPayload;

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

        // Enforce mandatory password change: users flagged with mustChangePassword
        // may only reach the change-password / logout / self-profile endpoints.
        if (decoded.mustChangePassword) {
            const path = req.originalUrl.split("?")[0] ?? req.originalUrl;
            if (!PASSWORD_CHANGE_ALLOWLIST.has(path)) {
                throw new AppError(403, "You must change your password before continuing");
            }
        }

        next();
    } catch (error) {
        // Genuine authentication failures → 401.
        // JWT verification errors (invalid/expired/malformed token) and 401-level AppErrors.
        // Preserve any machine-readable code (e.g. ACCOUNT_INACTIVE) so clients
        // like the rider PWA can branch on it.
        if (
            error instanceof jwt.JsonWebTokenError ||
            (error instanceof AppError && error.statusCode === 401)
        ) {
            return res.status(401).json({
                success: false,
                message: error instanceof AppError ? error.message : "Unauthorized",
                ...(error instanceof AppError && error.code ? { code: error.code } : {}),
            });
        }

        // Everything else (403 "must change password", missing JWT_SECRET,
        // database/Redis failures, unexpected errors) must surface — forward
        // to the global error handler instead of masking as 401.
        return next(error);
    }
}
