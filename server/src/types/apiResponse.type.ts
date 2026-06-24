export type ApiSuccessResponse<T = null> = {
  success: true;
  message: string;
  data?: T;
};

export type ApiErrorResponse = {
  success: false;
  message: string;
  error?: unknown;
  field?: string | string[]; // Optional field to indicate which field(s) caused the error
};

export type ApiResponseType<T = null> =
  | ApiSuccessResponse<T>
  | ApiErrorResponse;
