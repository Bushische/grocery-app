# Data Model (Drizzle ORM / SQLite)

File: `apps/api/src/db/schema.ts`. Money is stored as **integer cents** (`priceCents`) to avoid
floating-point issues; the API layer converts to/from decimal numbers. Timestamps are unix epoch
seconds (drizzle `timestamp` mode) and are returned as ISO 8601 strings by the API.

## Schema

```ts
import { sql } from "drizzle-orm";
import {
  index, integer, primaryKey, sqliteTable, text, uniqueIndex,
} from "drizzle-orm/sqlite-core";

const now = sql`(unixepoch())`;

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),                                  // cuid2
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),                // bcrypt
  role: text("role", { enum: ["user", "admin"] }).notNull().default("user"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
}, (t) => [uniqueIndex("users_email_uq").on(t.email)]);

export const refreshTokens = sqliteTable("refresh_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),                      // sha256 hex
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
}, (t) => [uniqueIndex("refresh_tokens_hash_uq").on(t.tokenHash)]);

export const apiTokens = sqliteTable("api_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),                      // sha256 hex of "glc_..." token
  name: text("name").notNull(),                                 // e.g. "ai-agent"
  lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
}, (t) => [uniqueIndex("api_tokens_hash_uq").on(t.tokenHash)]);

export const groceryLists = sqliteTable("lists", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
});

export const listMembers = sqliteTable("list_members", {
  listId: text("list_id").notNull().references(() => groceryLists.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["OWNER", "EDITOR", "VIEWER"] }).notNull(),
}, (t) => [primaryKey({ columns: [t.listId, t.userId] })]);

export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(),
  listId: text("list_id").notNull().references(() => groceryLists.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  color: text("color").notNull(),                               // #RRGGBB
  sortOrder: integer("sort_order").notNull().default(0),
}, (t) => [index("categories_list_idx").on(t.listId)]);

export const items = sqliteTable("items", {
  id: text("id").primaryKey(),
  listId: text("list_id").notNull().references(() => groceryLists.id, { onDelete: "cascade" }),
  categoryId: text("category_id").notNull().references(() => categories.id, { onDelete: "restrict" }),
  title: text("title").notNull(),
  qtyText: text("qty_text"),                                    // "2x", "500g"
  status: text("status", { enum: ["TO_BUY", "BOUGHT"] }).notNull().default("TO_BUY"),
  sortOrder: integer("sort_order").notNull().default(0),        // manual order (drag-and-drop)
  addedAt: integer("added_at", { mode: "timestamp" }).notNull().default(now),   // entered TO_BUY
  boughtAt: integer("bought_at", { mode: "timestamp" }),
  usageCount: integer("usage_count").notNull().default(0),      // times added to TO_BUY
  imageFilename: text("image_filename"),                        // under /data/images
}, (t) => [
  index("items_list_status_order_idx").on(t.listId, t.status, t.sortOrder),
  index("items_title_idx").on(t.title),
]);

export const priceObservations = sqliteTable("price_observations", {
  id: text("id").primaryKey(),
  itemId: text("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  priceCents: integer("price_cents").notNull(),                 // e.g. 199 = 1.99
  shop: text("shop").notNull(),
  observedAt: integer("observed_at", { mode: "timestamp" }).notNull().default(now),
}, (t) => [index("prices_item_observed_idx").on(t.itemId, t.observedAt)]);
```

## Notes
- **Current price is derived**: the latest `priceObservations` row for the item. There is no
  duplicated `current_price` column — one source of truth, no sync bugs.
- `daysInList` is computed at read time: `now - addedAt` for `TO_BUY` items.
- Deleting a category is rejected (`409`) while items reference it (client must reassign or
  delete them first) — SQLite enforces via `ON DELETE RESTRICT`.
- Deleting a list cascades to its categories, items, and price observations.
- Reordering updates `items.sortOrder` (0..n-1) inside one transaction per list+status.
- The "Other" default category is a normal `categories` row created automatically with each list.
- Fuzzy matching (smart-add / suggest) uses SQLite `LIKE` prefilter + a small pure-TS similarity
  score (Dice coefficient on lowercase titles). No extensions needed.
