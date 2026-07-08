import { Response } from "express";
import { ApiSuccessResponse } from "../types/apiResponse.type";

export function sendSuccess<T>(
  res: Response,
  statusCode: number,
  message: string,
  data?: T,
) {
  const response: ApiSuccessResponse<T> = {
    success: true,
    message,
    ...(data !== undefined && { data }),
  };
  return res.status(statusCode).json(response);
}
