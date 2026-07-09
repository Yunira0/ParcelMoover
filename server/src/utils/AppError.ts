export class AppError extends Error {
    statusCode: number;
    success: boolean;
    /** Optional machine-readable code (e.g. "ACCOUNT_INACTIVE") clients can branch on. */
    code?: string | undefined;
    /** Set on 429s where the upstream told us how long to back off (e.g. NCM's throttle). */
    retryAfterSeconds?: number | undefined;
    constructor(statuscode: number, message: string, code?: string, retryAfterSeconds?: number) {
        super(message)
        this.statusCode = statuscode;
        this.success = false;
        this.code = code;
        this.retryAfterSeconds = retryAfterSeconds;
        Object.setPrototypeOf(this, AppError.prototype);
    }
}