export class AppError extends Error {
    statusCode: number;
    success: boolean;
    /** Optional machine-readable code (e.g. "ACCOUNT_INACTIVE") clients can branch on. */
    code?: string | undefined;
    constructor(statuscode: number, message: string, code?: string) {
        super(message)
        this.statusCode = statuscode;
        this.success = false;
        this.code = code;
        Object.setPrototypeOf(this, AppError.prototype);
    }
}