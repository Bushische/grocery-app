import type { Category, UpdateCategoryRequest } from "@grocery/shared";
import { createId } from "@paralleldrive/cuid2";
import { asc, count, eq, max } from "drizzle-orm";
import type { Db } from "../db/client";
import { categories, items } from "../db/schema";
import { FastifyHttpError } from "../errors";

const categoryNotFound = (categoryId: string) =>
  new FastifyHttpError(404, "NOT_FOUND", `Category ${categoryId} not found`);

type CategoryRow = typeof categories.$inferSelect;

function toCategoryDto(row: CategoryRow, itemCount: number): Category {
  return {
    id: row.id,
    title: row.title,
    color: row.color,
    sortOrder: row.sortOrder,
    itemCount,
  };
}

function countItems(db: Db, categoryId: string): number {
  const row = db.select({ n: count() }).from(items).where(eq(items.categoryId, categoryId)).get();
  return row?.n ?? 0;
}

/**
 * Categories of one list with their item counts, ordered by `sortOrder`
 * (title as deterministic tiebreak — schema has no createdAt column).
 */
export function listCategories(db: Db, listId: string): Category[] {
  const rows = db
    .select()
    .from(categories)
    .where(eq(categories.listId, listId))
    .orderBy(asc(categories.sortOrder), asc(categories.title))
    .all();
  const counts = db
    .select({ categoryId: items.categoryId, n: count() })
    .from(items)
    .where(eq(items.listId, listId))
    .groupBy(items.categoryId)
    .all();
  const byCategory = new Map(counts.map((row) => [row.categoryId, row.n]));
  return rows.map((row) => toCategoryDto(row, byCategory.get(row.id) ?? 0));
}

/** Creates a category appended to the end of the list's manual order. */
export function createCategory(db: Db, listId: string, title: string, color: string): Category {
  const last = db
    .select({ highest: max(categories.sortOrder) })
    .from(categories)
    .where(eq(categories.listId, listId))
    .get();
  const sortOrder = (last?.highest ?? -1) + 1;

  const row = db
    .insert(categories)
    .values({ id: createId(), listId, title, color, sortOrder })
    .returning()
    .get();
  return toCategoryDto(row, 0);
}

/**
 * Applies a partial update; `title`/`color` are optional (docs/API.md), an
 * empty patch is a no-op that still validates the category exists.
 */
export function updateCategory(db: Db, categoryId: string, patch: UpdateCategoryRequest): Category {
  const set: { title?: string; color?: string } = {};
  if (patch.title !== undefined) {
    set.title = patch.title;
  }
  if (patch.color !== undefined) {
    set.color = patch.color;
  }

  if (Object.keys(set).length > 0) {
    const updated = db
      .update(categories)
      .set(set)
      .where(eq(categories.id, categoryId))
      .returning()
      .get();
    if (!updated) {
      throw categoryNotFound(categoryId);
    }
    return toCategoryDto(updated, countItems(db, categoryId));
  }

  const current = db.select().from(categories).where(eq(categories.id, categoryId)).get();
  if (!current) {
    throw categoryNotFound(categoryId);
  }
  return toCategoryDto(current, countItems(db, categoryId));
}

/**
 * Deletes a category unless items still reference it — SQLite enforces
 * `ON DELETE RESTRICT` (docs/DATA_MODEL.md), surfaced as 409 CONFLICT.
 */
export function deleteCategory(db: Db, categoryId: string): void {
  const itemCount = countItems(db, categoryId);
  if (itemCount > 0) {
    throw new FastifyHttpError(
      409,
      "CONFLICT",
      `Category still has ${itemCount} item(s) — reassign or delete them first`,
    );
  }
  const result = db.delete(categories).where(eq(categories.id, categoryId)).run();
  if (result.changes === 0) {
    throw categoryNotFound(categoryId);
  }
}
