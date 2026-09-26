export const API_BASE_PATH = "/api";

export type UserRole = "user" | "admin";
export type ListRole = "OWNER" | "EDITOR" | "VIEWER";
export type ItemStatus = "TO_BUY" | "BOUGHT";

export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT";

export type ApiError = { error: { code: ApiErrorCode | "INTERNAL_ERROR"; message: string } };
