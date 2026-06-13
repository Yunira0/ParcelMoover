export class AppError extends Error {
    statusCode: number;
    success: boolean
    constructor(statuscode: number, message: string) {
        super(message)
        this.statusCode = statuscode;
        this.success = false;
        Object.setPrototypeOf(this, AppError.prototype);
    }
}