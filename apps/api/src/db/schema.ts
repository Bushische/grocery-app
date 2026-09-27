import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const now = sql`(unixepoch())`;

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(), // cuid2
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(), // bcrypt
    role: text("role", { enum: ["user", "admin"] })
      .notNull()
      .default("user"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [uniqueIndex("users_email_uq").on(t.email)],
);

export const refreshTokens = sqliteTable(
  "refresh_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(), // sha256 hex
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [uniqueIndex("refresh_tokens_hash_uq").on(t.tokenHash)],
);

export const apiTokens = sqliteTable(
  "api_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(), // sha256 hex of "glc_..." token
    name: text("name").notNull(), // e.g. "ai-agent"
    lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [uniqueIndex("api_tokens_hash_uq").on(t.tokenHash)],
);

export const groceryLists = sqliteTable("lists", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
});

export const listMembers = sqliteTable(
  "list_members",
  {
    listId: text("list_id")
      .notNull()
      .references(() => groceryLists.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["OWNER", "EDITOR", "VIEWER"] }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.listId, t.userId] })],
);

export const categories = sqliteTable(
  "categories",
  {
    id: text("id").primaryKey(),
    listId: text("list_id")
      .notNull()
      .references(() => groceryLists.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    color: text("color").notNull(), // #RRGGBB
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    index("categories_list_idx").on(t.listId),
    // Title is unique per list — keeps the self-healing default "Other"
    // category (itemService.defaultCategoryId) from ever being duplicated.
    uniqueIndex("categories_list_title_uq").on(t.listId, t.title),
  ],
);

export const items = sqliteTable(
  "items",
  {
    id: text("id").primaryKey(),
    listId: text("list_id")
      .notNull()
      .references(() => groceryLists.id, { onDelete: "cascade" }),
    categoryId: text("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    qtyText: text("qty_text"), // "2x", "500g"
    status: text("status", { enum: ["TO_BUY", "BOUGHT"] })
      .notNull()
      .default("TO_BUY"),
    sortOrder: integer("sort_order").notNull().default(0), // manual order (drag-and-drop)
    addedAt: integer("added_at", { mode: "timestamp" }).notNull().default(now), // entered TO_BUY
    boughtAt: integer("bought_at", { mode: "timestamp" }),
    usageCount: integer("usage_count").notNull().default(0), // times added to TO_BUY
    imageFilename: text("image_filename"), // under /data/images
  },
  (t) => [
    index("items_list_status_order_idx").on(t.listId, t.status, t.sortOrder),
    index("items_title_idx").on(t.title),
  ],
);

export const priceObservations = sqliteTable(
  "price_observations",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    priceCents: integer("price_cents").notNull(), // e.g. 199 = 1.99
    shop: text("shop").notNull(),
    observedAt: integer("observed_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [index("prices_item_observed_idx").on(t.itemId, t.observedAt)],
);
