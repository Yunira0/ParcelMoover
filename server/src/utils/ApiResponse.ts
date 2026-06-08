import { response, Response } from "express";
import {
  ApiErrorResponse,
  ApiSuccessResponse,
} from "../types/apiResponse.type";



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


export function sendError(
  res: Response,
  statusCode: number,
  message: string,
  error?: unknown,
) {
  const response: ApiErrorResponse = {
    success: false,
    message,
    ...(error !== undefined && { error }),
  };
  return res.status(statusCode).json(response);
}
