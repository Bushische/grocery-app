import { z } from "zod";

export const API_BASE_PATH = "/api";

export type UserRole = "user" | "admin";
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

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email());

export const loginRequestSchema = z.object({
  email: emailSchema,
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

// --- Lists (docs/API.md → Lists; docs/PROJECT.md → Lists) ---

/** Membership roles per list, ordered VIEWER < EDITOR < OWNER. */
export const listRoleSchema = z.enum(["OWNER", "EDITOR", "VIEWER"]);
export type ListRole = z.infer<typeof listRoleSchema>;

/** Trimmed, non-empty title (lists now; categories/items in later tasks). */
export const titleSchema = z.string().trim().min(1);

export const itemCountsSchema = z.object({
  toBuy: z.number().int().min(0),
  bought: z.number().int().min(0),
});
export type ItemCounts = z.infer<typeof itemCountsSchema>;

/** Element of `GET /lists` and the response of `POST`/`PATCH /lists`. */
export const listSummarySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  role: listRoleSchema,
  itemCounts: itemCountsSchema,
});
export type ListSummary = z.infer<typeof listSummarySchema>;

export const createListRequestSchema = z.object({ title: titleSchema });
export type CreateListRequest = z.infer<typeof createListRequestSchema>;

export const updateListRequestSchema = z.object({ title: titleSchema });
export type UpdateListRequest = z.infer<typeof updateListRequestSchema>;

export const listMemberSchema = z.object({
  userId: z.string().min(1),
  email: z.string().min(1),
  role: listRoleSchema,
});
export type ListMember = z.infer<typeof listMemberSchema>;

/** Response of `GET /lists/:id` per docs/API.md. */
export const listDetailSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  owner: z.object({ id: z.string().min(1), email: z.string().min(1) }),
  members: z.array(listMemberSchema),
});
export type ListDetail = z.infer<typeof listDetailSchema>;

export const addListMemberRequestSchema = z.object({
  email: emailSchema,
  role: listRoleSchema,
});
export type AddListMemberRequest = z.infer<typeof addListMemberRequestSchema>;

export const updateListMemberRequestSchema = z.object({ role: listRoleSchema });
export type UpdateListMemberRequest = z.infer<typeof updateListMemberRequestSchema>;

// --- Categories (docs/API.md → Categories; docs/PROJECT.md → Categories) ---

/** ISO 8601 UTC timestamp string as returned by the API (docs/API.md → Conventions). */
export const isoDateTimeSchema = z.iso.datetime();
export type IsoDateTime = z.infer<typeof isoDateTimeSchema>;

/** `#RRGGBB` hex color (docs/DATA_MODEL.md → categories.color). */
export const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export type HexColor = z.infer<typeof hexColorSchema>;

/** Element of `GET /lists/:id/categories`. */
export const categorySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  color: hexColorSchema,
  sortOrder: z.number().int().min(0),
  itemCount: z.number().int().min(0),
});
export type Category = z.infer<typeof categorySchema>;

export const createCategoryRequestSchema = z.object({
  title: titleSchema,
  color: hexColorSchema,
});
export type CreateCategoryRequest = z.infer<typeof createCategoryRequestSchema>;

/** Empty object allowed — `PATCH /categories/:id` with no fields is a no-op. */
export const updateCategoryRequestSchema = z.object({
  title: titleSchema.optional(),
  color: hexColorSchema.optional(),
});
export type UpdateCategoryRequest = z.infer<typeof updateCategoryRequestSchema>;

// --- Items (docs/API.md → Items) ---
// Built incrementally: T7 exposes this DTO via `GET /categories/:id/items`,
// T8 via `GET /lists/:id/items`; T11 adds `currentPrice` to item reads.

export const itemStatusSchema = z.enum(["TO_BUY", "BOUGHT"]);

/** Category reference embedded in item reads. */
export const itemCategorySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  color: hexColorSchema,
});
export type ItemCategory = z.infer<typeof itemCategorySchema>;

export const itemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  qtyText: z.string().nullable(),
  status: itemStatusSchema,
  sortOrder: z.number().int().min(0),
  addedAt: isoDateTimeSchema,
  /** Whole days since addedAt, computed at read time (docs/DATA_MODEL.md → Notes). */
  daysInList: z.number().int().min(0),
  category: itemCategorySchema,
  imageFilename: z.string().nullable(),
});
export type Item = z.infer<typeof itemSchema>;

/** Envelope of the item-collection endpoints (`GET /lists/:id/items`, `GET /categories/:id/items`). */
export const itemsResponseSchema = z.object({ items: z.array(itemSchema) });
export type ItemsResponse = z.infer<typeof itemsResponseSchema>;
