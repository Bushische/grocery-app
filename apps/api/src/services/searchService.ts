import type { SearchResult, SuggestGroup, SuggestItem } from "@grocery/shared";
import { MAX_SUGGEST_RESULTS } from "@grocery/shared";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { categories, items, listMembers } from "../db/schema";
import { bigrams, diceCoefficient, escapeLike } from "./textMatching";

/** Minimum Dice score for a fuzzy suggest candidate (smart-add step 3 parity). */
const FUZZY_THRESHOLD = 0.6;

/** Joined row shape for suggest/search reads: the item plus its category. */
type ItemRow = {
  item: typeof items.$inferSelect;
  category: typeof categories.$inferSelect;
};

function toSuggestItem(row: ItemRow) {
  return {
    id: row.item.id,
    title: row.item.title,
    qtyText: row.item.qtyText,
    status: row.item.status,
  };
}

/**
 * `GET /items/suggest` (docs/API.md → Suggest & Search): LIKE prefilter (the
 * query itself and each of its bigrams) + Dice score within one list; substring
 * matches always count, fuzzy matches need Dice ≥ 0.6. Ranked usageCount DESC
 * (then score, then title), max 20 items, grouped by category in the list's
 * category order (docs/PROJECT.md → UX: grouped suggestions with color bars).
 */
export function suggestItems(
  db: Db,
  listId: string,
  query: string,
  max: number = MAX_SUGGEST_RESULTS,
): SuggestGroup[] {
  const lowerQuery = query.toLowerCase();
  const grams = [...bigrams(query)];
  const rows = db
    .select({ item: items, category: categories })
    .from(items)
    .innerJoin(categories, eq(items.categoryId, categories.id))
    .where(
      and(
        eq(items.listId, listId),
        or(
          sql`${items.title} LIKE ${`%${escapeLike(query)}%`} ESCAPE '\\'`,
          ...grams.map((gram) => sql`${items.title} LIKE ${`%${escapeLike(gram)}%`} ESCAPE '\\'`),
        ),
      ),
    )
    .all();
  const matches = rows
    .map((row) => ({
      row,
      contains: row.item.title.toLowerCase().includes(lowerQuery),
      score: diceCoefficient(query, row.item.title),
    }))
    .filter((candidate) => candidate.contains || candidate.score >= FUZZY_THRESHOLD)
    .sort(
      (a, b) =>
        b.row.item.usageCount - a.row.item.usageCount ||
        b.score - a.score ||
        a.row.item.title.localeCompare(b.row.item.title),
    )
    .slice(0, max);

  const categoryOrder = db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.listId, listId))
    .orderBy(asc(categories.sortOrder), asc(categories.title))
    .all()
    .map((row) => row.id);
  const rankOf = new Map(categoryOrder.map((id, index) => [id, index]));

  const groups = new Map<string, { category: ItemRow["category"]; items: SuggestItem[] }>();
  for (const candidate of matches) {
    let group = groups.get(candidate.row.category.id);
    if (!group) {
      group = { category: candidate.row.category, items: [] };
      groups.set(candidate.row.category.id, group);
    }
    group.items.push(toSuggestItem(candidate.row));
  }
  return [...groups.entries()]
    .sort((a, b) => (rankOf.get(a[0]) ?? 0) - (rankOf.get(b[0]) ?? 0))
    .map(([, group]) => group);
}

/**
 * `GET /search` (docs/API.md → Suggest & Search): substring search (LIKE both
 * ways, smart-add step 2 semantics) across the lists the user is a member of,
 * optionally narrowed to one list; ordered by usageCount DESC then title.
 */
export function searchItems(
  db: Db,
  userId: string,
  query: string,
  listId?: string,
): SearchResult[] {
  const pattern = `%${escapeLike(query)}%`;
  const escapedTitle = sql`replace(replace(replace(${items.title}, '\\', '\\\\'), '%', '\\%'), '_', '\\_')`;
  const memberListIds = db
    .select({ listId: listMembers.listId })
    .from(listMembers)
    .where(eq(listMembers.userId, userId))
    .all()
    .map((row) => row.listId);
  if (memberListIds.length === 0) {
    return [];
  }
  const accessibleListIds = listId
    ? memberListIds.filter((memberListId) => memberListId === listId)
    : memberListIds;
  if (accessibleListIds.length === 0) {
    return [];
  }
  const rows = db
    .select({ item: items, category: categories })
    .from(items)
    .innerJoin(categories, eq(items.categoryId, categories.id))
    .where(
      and(
        inArray(items.listId, accessibleListIds),
        or(
          sql`${items.title} LIKE ${pattern} ESCAPE '\\'`,
          sql`${query} LIKE ('%' || ${escapedTitle} || '%') ESCAPE '\\'`,
        ),
      ),
    )
    .orderBy(desc(items.usageCount), asc(items.title))
    .all();
  return rows.map((row) => ({
    itemId: row.item.id,
    listId: row.item.listId,
    title: row.item.title,
    status: row.item.status,
    categoryColor: row.category.color,
  }));
}
