import { z } from "zod";

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

// --- Auth (docs/API.md → Auth; docs/PROJECT.md → Auth) ---

/** Refresh token cookie — HttpOnly/Secure/SameSite=Strict, scoped to the refresh endpoint. */
export const REFRESH_COOKIE_NAME = "refresh_token";
export const REFRESH_COOKIE_PATH = "/api/auth";
/** 30 days — matches `Max-Age=2592000` in docs/API.md. */
export const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

export const loginRequestSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const authUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().min(1),
  role: z.enum(["user", "admin"]),
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const loginResponseSchema = z.object({
  accessToken: z.string().min(1),
  user: authUserSchema,
});
/** Response of both `POST /auth/login` and `POST /auth/refresh`. */
export type LoginResponse = z.infer<typeof loginResponseSchema>;
