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

// --- Prices (docs/API.md → Prices; docs/DATA_MODEL.md → priceObservations) ---

/** Price observation as returned by the API — money as a decimal number (docs/API.md → Conventions). */
export const priceObservationSchema = z.object({
  price: z.number().positive(),
  shop: z.string().min(1),
  observedAt: isoDateTimeSchema,
});
export type PriceObservation = z.infer<typeof priceObservationSchema>;

/** `POST /items/:id/prices` — `observedAt` is optional and defaults to server time. */
export const createPriceObservationRequestSchema = z.object({
  price: z.number().positive(),
  shop: z.string().trim().min(1),
  observedAt: isoDateTimeSchema.optional(),
});
export type CreatePriceObservationRequest = z.infer<typeof createPriceObservationRequestSchema>;

/** Response of `GET /items/:id/prices` — observations newest first; `nextCursor` null on the last page. */
export const pricesResponseSchema = z.object({
  observations: z.array(priceObservationSchema),
  nextCursor: z.string().nullable(),
});
export type PricesResponse = z.infer<typeof pricesResponseSchema>;

/** Cursor pagination defaults (docs/API.md → Conventions: "default 50, max 100"). */
export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 100;

// --- Items (docs/API.md → Items) ---
// Built incrementally: T7 exposes this DTO via `GET /categories/:id/items`,
// T8 via `GET /lists/:id/items`; T11 added `currentPrice` to item reads.

export const itemStatusSchema = z.enum(["TO_BUY", "BOUGHT"]);

/** `?status=` values of `GET /lists/:id/items` (docs/API.md → Items). */
export const itemStatusFilterSchema = z.enum(["to_buy", "bought"]);
export type ItemStatusFilter = z.infer<typeof itemStatusFilterSchema>;

/** Maps a `?status=` filter value to the stored status enum. */
export const itemStatusByFilter: Record<ItemStatusFilter, ItemStatus> = {
  to_buy: "TO_BUY",
  bought: "BOUGHT",
};

/** Optional free-text quantity like "2x" or "500g" (docs/DATA_MODEL.md → items.qty_text). */
export const qtyTextSchema = z.string().trim().min(1);

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
  /** Latest price observation, or null when the item has none (docs/DATA_MODEL.md → Notes). */
  currentPrice: priceObservationSchema.nullable(),
});
export type Item = z.infer<typeof itemSchema>;

/** Envelope of the item-collection endpoints (`GET /lists/:id/items`, `GET /categories/:id/items`). */
export const itemsResponseSchema = z.object({ items: z.array(itemSchema) });
export type ItemsResponse = z.infer<typeof itemsResponseSchema>;

export const createItemRequestSchema = z.object({
  title: titleSchema,
  categoryId: z.string().min(1).optional(),
  qtyText: qtyTextSchema.nullable().optional(),
});
export type CreateItemRequest = z.infer<typeof createItemRequestSchema>;

/** `PATCH /items/:id` — every field optional; `qtyText: null` clears it. */
export const updateItemRequestSchema = z.object({
  title: titleSchema.optional(),
  categoryId: z.string().min(1).optional(),
  qtyText: qtyTextSchema.nullable().optional(),
});
export type UpdateItemRequest = z.infer<typeof updateItemRequestSchema>;

/** `POST /items/:id/move` — the move endpoint takes the same filter-style status values
 * as the item list query (`"bought"` / `"to_buy"`, docs/API.md → Items). */
export const moveItemRequestSchema = z.object({ status: itemStatusFilterSchema });
export type MoveItemRequest = z.infer<typeof moveItemRequestSchema>;

/** `POST /lists/:id/items/smart-add` — free text from the bottom input box. */
export const smartAddRequestSchema = z.object({ text: titleSchema });
export type SmartAddRequest = z.infer<typeof smartAddRequestSchema>;

/** How smart-add resolved the input (docs/API.md → Items, algorithm steps 1–4). */
export const smartAddMatchedBySchema = z.enum(["exact", "substring", "fuzzy", "created"]);
export type SmartAddMatchedBy = z.infer<typeof smartAddMatchedBySchema>;

export const smartAddResponseSchema = z.object({
  created: z.boolean(),
  matchedBy: smartAddMatchedBySchema,
  item: itemSchema,
});
export type SmartAddResponse = z.infer<typeof smartAddResponseSchema>;

/** Response of `GET /items/:id` — the item (incl. currentPrice) plus its price history, newest first. */
export const itemDetailSchema = itemSchema.extend({ prices: z.array(priceObservationSchema) });
export type ItemDetail = z.infer<typeof itemDetailSchema>;

// --- Suggest & Search (docs/API.md → Suggest & Search; docs/TASKS.md → T12) ---

/** Max items returned by `GET /items/suggest` (docs/API.md → Suggest & Search). */
export const MAX_SUGGEST_RESULTS = 20;

/** Suggested item row — the subset the bottom input box renders. */
export const suggestItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  qtyText: z.string().nullable(),
  status: itemStatusSchema,
});
export type SuggestItem = z.infer<typeof suggestItemSchema>;

/** One category group of the suggest response — items keep the suggest order. */
export const suggestGroupSchema = z.object({
  category: itemCategorySchema,
  items: z.array(suggestItemSchema),
});
export type SuggestGroup = z.infer<typeof suggestGroupSchema>;

export const suggestResponseSchema = z.object({ groups: z.array(suggestGroupSchema) });
export type SuggestResponse = z.infer<typeof suggestResponseSchema>;

/** Element of `GET /search` — flat rows across the user's lists. */
export const searchResultSchema = z.object({
  itemId: z.string().min(1),
  listId: z.string().min(1),
  title: z.string().min(1),
  status: itemStatusSchema,
  categoryColor: hexColorSchema,
});
export type SearchResult = z.infer<typeof searchResultSchema>;

export const searchResponseSchema = z.object({ results: z.array(searchResultSchema) });
export type SearchResponse = z.infer<typeof searchResponseSchema>;

// --- Item images (docs/API.md → Items — image; docs/TASKS.md → T10) ---

/** Max multipart upload size for item images (docs/API.md → Items: "< 2 MB"). */
export const MAX_IMAGE_UPLOAD_BYTES = 2 * 1024 * 1024;

/** Longest edge of the server-side-resized webp (docs/TASKS.md → T10: 600 px). */
export const MAX_IMAGE_DIMENSION = 600;

/** Response of `POST /items/:id/image` — the content-addressed filename under /static. */
export const itemImageResponseSchema = z.object({ imageFilename: z.string().min(1) });
export type ItemImageResponse = z.infer<typeof itemImageResponseSchema>;
