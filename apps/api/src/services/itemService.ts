import type {
  CreateItemRequest,
  Item,
  ItemDetail,
  ItemStatus,
  PriceObservation,
  SmartAddMatchedBy,
  UpdateItemRequest,
} from "@grocery/shared";
import { createId } from "@paralleldrive/cuid2";
import { and, asc, desc, eq, max, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { categories, items, priceObservations } from "../db/schema";
import { FastifyHttpError } from "../errors";
import { DEFAULT_CATEGORY_TITLE } from "./listService";
import { bigrams, diceCoefficient, escapeLike } from "./textMatching";

/** One day in milliseconds — `daysInList` granularity (docs/DATA_MODEL.md → Notes). */
const DAY_MS = 86_400_000;

/** Minimum Sørensen–Dice score for a fuzzy smart-add match (docs/API.md → Items). */
const FUZZY_THRESHOLD = 0.6;

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

const itemNotFound = (itemId: string) =>
  new FastifyHttpError(404, "NOT_FOUND", `Item ${itemId} not found`);

function getItemRow(db: Db, itemId: string): ItemRow | undefined {
  return db
    .select({ item: items, category: categories })
    .from(items)
    .innerJoin(categories, eq(items.categoryId, categories.id))
    .where(eq(items.id, itemId))
    .get();
}

/** Highest sortOrder of the list's items in one status (empty section → -1). */
function highestSortOrder(db: Db, listId: string, status: ItemStatus): number {
  const row = db
    .select({ highest: max(items.sortOrder) })
    .from(items)
    .where(and(eq(items.listId, listId), eq(items.status, status)))
    .get();
  return row?.highest ?? -1;
}

/**
 * The list's default "Other" category — smart-add and plain creates fall back
 * to it (docs/PROJECT.md → Categories). A list always has one (created with
 * the list in T6), so a missing row is an internal invariant breach.
 */
function defaultCategoryId(db: Db, listId: string): string {
  const category = db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.listId, listId), eq(categories.title, DEFAULT_CATEGORY_TITLE)))
    .get();
  if (!category) {
    throw new FastifyHttpError(
      500,
      "INTERNAL_ERROR",
      `List ${listId} is missing its default "Other" category`,
    );
  }
  return category.id;
}

/** Rejects categoryId values that do not belong to the list (400, docs/API.md → Conventions). */
function requireCategoryInList(db: Db, listId: string, categoryId: string): void {
  const category = db
    .select({ listId: categories.listId })
    .from(categories)
    .where(eq(categories.id, categoryId))
    .get();
  if (!category || category.listId !== listId) {
    throw new FastifyHttpError(
      400,
      "VALIDATION_ERROR",
      `Category ${categoryId} does not belong to this list`,
    );
  }
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

/**
 * All items of one list, optionally filtered by status, ordered by
 * sortOrder then addedAt (docs/API.md → Items).
 */
export function listItems(
  db: Db,
  listId: string,
  status?: ItemStatus,
  now: Date = new Date(),
): Item[] {
  const rows = db
    .select({ item: items, category: categories })
    .from(items)
    .innerJoin(categories, eq(items.categoryId, categories.id))
    .where(
      status ? and(eq(items.listId, listId), eq(items.status, status)) : eq(items.listId, listId),
    )
    .orderBy(asc(items.sortOrder), asc(items.addedAt))
    .all();
  return rows.map((row) => toItemDto(row, now));
}

/** Price history of an item, newest first, cents converted to decimal (docs/API.md → Conventions). */
function listPriceObservations(db: Db, itemId: string): PriceObservation[] {
  return db
    .select({
      priceCents: priceObservations.priceCents,
      shop: priceObservations.shop,
      observedAt: priceObservations.observedAt,
    })
    .from(priceObservations)
    .where(eq(priceObservations.itemId, itemId))
    .orderBy(desc(priceObservations.observedAt))
    .all()
    .map((row) => ({
      price: row.priceCents / 100,
      shop: row.shop,
      observedAt: row.observedAt.toISOString(),
    }));
}

/** `GET /items/:id` — the item DTO plus its price history (docs/API.md → Items). */
export function getItemDetail(db: Db, itemId: string, now: Date = new Date()): ItemDetail {
  const row = getItemRow(db, itemId);
  if (!row) {
    throw itemNotFound(itemId);
  }
  return { ...toItemDto(row, now), prices: listPriceObservations(db, itemId) };
}

/** Creates a TO_BUY item appended to the end of the section (sortOrder = max+1). */
export function createItem(
  db: Db,
  listId: string,
  request: CreateItemRequest,
  now: Date = new Date(),
): Item {
  const categoryId = request.categoryId ?? defaultCategoryId(db, listId);
  requireCategoryInList(db, listId, categoryId);
  const row = db
    .insert(items)
    .values({
      id: createId(),
      listId,
      categoryId,
      title: request.title,
      qtyText: request.qtyText ?? null,
      status: "TO_BUY",
      sortOrder: highestSortOrder(db, listId, "TO_BUY") + 1,
      addedAt: now,
    })
    .returning()
    .get();
  const category = db.select().from(categories).where(eq(categories.id, categoryId)).get();
  if (!category) {
    throw new FastifyHttpError(500, "INTERNAL_ERROR", `Category ${categoryId} is missing`);
  }
  return toItemDto({ item: row, category }, now);
}

/** Applies a partial update; every field is optional (docs/API.md → Items). */
export function updateItem(
  db: Db,
  itemId: string,
  patch: UpdateItemRequest,
  now: Date = new Date(),
): Item {
  const current = getItemRow(db, itemId);
  if (!current) {
    throw itemNotFound(itemId);
  }
  if (patch.categoryId !== undefined) {
    requireCategoryInList(db, current.item.listId, patch.categoryId);
  }
  const set: { title?: string; categoryId?: string; qtyText?: string | null } = {};
  if (patch.title !== undefined) {
    set.title = patch.title;
  }
  if (patch.categoryId !== undefined) {
    set.categoryId = patch.categoryId;
  }
  if (patch.qtyText !== undefined) {
    set.qtyText = patch.qtyText;
  }
  if (Object.keys(set).length > 0) {
    db.update(items).set(set).where(eq(items.id, itemId)).run();
  }
  const row = getItemRow(db, itemId);
  if (!row) {
    throw itemNotFound(itemId);
  }
  return toItemDto(row, now);
}

/** Deletes the item; its price observations cascade (schema FK). */
export function deleteItem(db: Db, itemId: string): void {
  const result = db.delete(items).where(eq(items.id, itemId)).run();
  if (result.changes === 0) {
    throw itemNotFound(itemId);
  }
}

export type SmartAddResult = {
  created: boolean;
  matchedBy: SmartAddMatchedBy;
  item: Item;
};

/**
 * Substring match both ways via SQLite LIKE (docs/API.md → smart-add step 2):
 * the query contains the title, or the title contains the query. Candidates
 * rank by usageCount DESC, then the smaller title-length diff, then title.
 */
function findSubstringMatch(db: Db, listId: string, text: string): ItemRow | undefined {
  const pattern = `%${escapeLike(text)}%`;
  const escapedTitle = sql`replace(replace(replace(${items.title}, '\\', '\\\\'), '%', '\\%'), '_', '\\_')`;
  const rows = db
    .select({ item: items, category: categories })
    .from(items)
    .innerJoin(categories, eq(items.categoryId, categories.id))
    .where(
      and(
        eq(items.listId, listId),
        or(
          sql`${items.title} LIKE ${pattern} ESCAPE '\\'`,
          sql`${text} LIKE ('%' || ${escapedTitle} || '%') ESCAPE '\\'`,
        ),
      ),
    )
    .all();
  if (rows.length === 0) {
    return undefined;
  }
  return rows
    .map((row) => ({ row, diff: Math.abs(row.item.title.length - text.length) }))
    .sort(
      (a, b) =>
        b.row.item.usageCount - a.row.item.usageCount ||
        a.diff - b.diff ||
        a.row.item.title.localeCompare(b.row.item.title),
    )[0]?.row;
}

/**
 * Fuzzy match (docs/API.md → smart-add step 3): SQLite LIKE prefilter on the
 * query's bigrams (dice ≥ 0.6 implies shared bigrams, so the prefilter is
 * lossless), then the pure-TS Dice score picks the best candidate.
 */
function findFuzzyMatch(db: Db, listId: string, text: string): ItemRow | undefined {
  const grams = [...bigrams(text)];
  if (grams.length === 0) {
    return undefined;
  }
  const rows = db
    .select({ item: items, category: categories })
    .from(items)
    .innerJoin(categories, eq(items.categoryId, categories.id))
    .where(
      and(
        eq(items.listId, listId),
        or(...grams.map((gram) => sql`${items.title} LIKE ${`%${escapeLike(gram)}%`} ESCAPE '\\'`)),
      ),
    )
    .all();
  return rows
    .map((row) => ({ row, score: diceCoefficient(text, row.item.title) }))
    .filter((candidate) => candidate.score >= FUZZY_THRESHOLD)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.row.item.usageCount - a.row.item.usageCount ||
        a.row.item.title.localeCompare(b.row.item.title),
    )[0]?.row;
}

/**
 * Re-activates a matched BOUGHT item (docs/API.md → Items): back to TO_BUY
 * with addedAt = now, boughtAt = null, usageCount+1, appended to the end of
 * the TO_BUY section (same semantics as the move endpoint, T9).
 */
function activateIfBought(db: Db, row: ItemRow, now: Date): Item {
  if (row.item.status !== "BOUGHT") {
    return toItemDto(row, now);
  }
  const updated = db
    .update(items)
    .set({
      status: "TO_BUY",
      addedAt: now,
      boughtAt: null,
      usageCount: row.item.usageCount + 1,
      sortOrder: highestSortOrder(db, row.item.listId, "TO_BUY") + 1,
    })
    .where(eq(items.id, row.item.id))
    .returning()
    .get();
  if (!updated) {
    throw itemNotFound(row.item.id);
  }
  return toItemDto({ item: updated, category: row.category }, now);
}

/**
 * smart-add (docs/API.md → Items): exact title match (case-insensitive) →
 * substring match both ways (LIKE) → fuzzy match (Dice ≥ 0.6) → create in
 * the default "Other" category. A matched BOUGHT item is re-activated; a
 * matched TO_BUY item is returned unchanged.
 */
export function smartAddItem(
  db: Db,
  listId: string,
  text: string,
  now: Date = new Date(),
): SmartAddResult {
  return db.transaction((tx) => {
    const exact = tx
      .select({ item: items, category: categories })
      .from(items)
      .innerJoin(categories, eq(items.categoryId, categories.id))
      .where(and(eq(items.listId, listId), sql`lower(${items.title}) = lower(${text})`))
      .get();
    if (exact) {
      return {
        created: false,
        matchedBy: "exact" as const,
        item: activateIfBought(tx, exact, now),
      };
    }

    const substring = findSubstringMatch(tx, listId, text);
    if (substring) {
      return {
        created: false,
        matchedBy: "substring" as const,
        item: activateIfBought(tx, substring, now),
      };
    }

    const fuzzy = findFuzzyMatch(tx, listId, text);
    if (fuzzy) {
      return {
        created: false,
        matchedBy: "fuzzy" as const,
        item: activateIfBought(tx, fuzzy, now),
      };
    }

    const categoryId = defaultCategoryId(tx, listId);
    const created = tx
      .insert(items)
      .values({
        id: createId(),
        listId,
        categoryId,
        title: text,
        qtyText: null,
        status: "TO_BUY",
        sortOrder: highestSortOrder(tx, listId, "TO_BUY") + 1,
        addedAt: now,
      })
      .returning()
      .get();
    const category = tx.select().from(categories).where(eq(categories.id, categoryId)).get();
    if (!category) {
      throw new FastifyHttpError(500, "INTERNAL_ERROR", `Category ${categoryId} is missing`);
    }
    return {
      created: true,
      matchedBy: "created" as const,
      item: toItemDto({ item: created, category }, now),
    };
  });
}
