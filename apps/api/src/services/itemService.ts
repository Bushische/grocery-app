import type { Item } from "@grocery/shared";
import { asc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { categories, items } from "../db/schema";

/** One day in milliseconds — `daysInList` granularity (docs/DATA_MODEL.md → Notes). */
const DAY_MS = 86_400_000;

/** Joined row shape used for item reads: the item plus its category. */
export type ItemRow = {
  item: typeof items.$inferSelect;
  category: typeof categories.$inferSelect;
};

/** `now - addedAt` in whole days, clamped at 0 (docs/DATA_MODEL.md → Notes). */
export function computeDaysInList(addedAt: Date, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - addedAt.getTime()) / DAY_MS));
}

/** Maps a joined item+category row to the API item DTO (docs/API.md → Items). */
export function toItemDto(row: ItemRow, now: Date = new Date()): Item {
  return {
    id: row.item.id,
    title: row.item.title,
    qtyText: row.item.qtyText,
    status: row.item.status,
    sortOrder: row.item.sortOrder,
    addedAt: row.item.addedAt.toISOString(),
    daysInList: computeDaysInList(row.item.addedAt, now),
    category: {
      id: row.category.id,
      title: row.category.title,
      color: row.category.color,
    },
    imageFilename: row.item.imageFilename,
  };
}

/** All items of one category, any status, ordered by sortOrder then addedAt. */
export function listItemsByCategory(db: Db, categoryId: string, now: Date = new Date()): Item[] {
  const rows = db
    .select({ item: items, category: categories })
    .from(items)
    .innerJoin(categories, eq(items.categoryId, categories.id))
    .where(eq(items.categoryId, categoryId))
    .orderBy(asc(items.sortOrder), asc(items.addedAt))
    .all();
  return rows.map((row) => toItemDto(row, now));
}
