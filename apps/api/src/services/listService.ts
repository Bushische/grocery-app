import type { ItemCounts, ListDetail, ListMember, ListRole, ListSummary } from "@grocery/shared";
import { createId } from "@paralleldrive/cuid2";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { categories, groceryLists, items, listMembers, users } from "../db/schema";
import { FastifyHttpError } from "../errors";

/** Privilege order used by requireListRole and member sorting. */
const ROLE_ORDER: readonly ListRole[] = ["VIEWER", "EDITOR", "OWNER"];

export const roleRank = (role: ListRole): number => ROLE_ORDER.indexOf(role);

/** Default category every new list gets (docs/API.md → Lists; smart-add fallback). */
export const DEFAULT_CATEGORY_TITLE = "Other";
export const DEFAULT_CATEGORY_COLOR = "#6B7280";

const listNotFound = (listId: string) =>
  new FastifyHttpError(404, "NOT_FOUND", `List ${listId} not found`);

export function getMembership(db: Db, listId: string, userId: string): ListRole | undefined {
  const row = db
    .select({ role: listMembers.role })
    .from(listMembers)
    .where(and(eq(listMembers.listId, listId), eq(listMembers.userId, userId)))
    .get();
  return row?.role;
}

/**
 * Resolves the caller's role for a list, throwing 404 when the list does not
 * exist and 403 when it does but the caller is not a member (docs/TASKS.md T6:
 * unauthorized access → 403).
 */
export function requireMembership(db: Db, listId: string, userId: string): ListRole {
  const row = db
    .select({ role: listMembers.role })
    .from(groceryLists)
    .leftJoin(
      listMembers,
      and(eq(listMembers.listId, groceryLists.id), eq(listMembers.userId, userId)),
    )
    .where(eq(groceryLists.id, listId))
    .get();
  if (!row) {
    throw listNotFound(listId);
  }
  if (!row.role) {
    throw new FastifyHttpError(403, "FORBIDDEN", "You are not a member of this list");
  }
  return row.role;
}

function countsByListId(db: Db, listIds: readonly string[]): Map<string, ItemCounts> {
  const byList = new Map<string, ItemCounts>();
  if (listIds.length === 0) {
    return byList;
  }
  const rows = db
    .select({ listId: items.listId, status: items.status, n: count() })
    .from(items)
    .where(inArray(items.listId, [...listIds]))
    .groupBy(items.listId, items.status)
    .all();
  for (const row of rows) {
    const counts = byList.get(row.listId) ?? { toBuy: 0, bought: 0 };
    if (row.status === "TO_BUY") {
      counts.toBuy = row.n;
    } else {
      counts.bought = row.n;
    }
    byList.set(row.listId, counts);
  }
  return byList;
}

export function getItemCounts(db: Db, listId: string): ItemCounts {
  return countsByListId(db, [listId]).get(listId) ?? { toBuy: 0, bought: 0 };
}

/** Lists the user is a member of, with their role and TO_BUY/BOUGHT counts. */
export function listListsForUser(db: Db, userId: string): ListSummary[] {
  const lists = db
    .select({ id: groceryLists.id, title: groceryLists.title, role: listMembers.role })
    .from(listMembers)
    .innerJoin(groceryLists, eq(listMembers.listId, groceryLists.id))
    .where(eq(listMembers.userId, userId))
    .orderBy(asc(groceryLists.createdAt), asc(groceryLists.id))
    .all();
  const byList = countsByListId(
    db,
    lists.map((list) => list.id),
  );
  return lists.map((list) => ({
    id: list.id,
    title: list.title,
    role: list.role,
    itemCounts: byList.get(list.id) ?? { toBuy: 0, bought: 0 },
  }));
}

/**
 * Creates a list in one transaction: the list row, the creator's OWNER
 * membership, and the default "Other" category (docs/API.md → Lists).
 */
export function createList(db: Db, userId: string, title: string): ListSummary {
  return db.transaction((tx) => {
    const list = tx
      .insert(groceryLists)
      .values({ id: createId(), title, ownerId: userId })
      .returning()
      .get();
    tx.insert(listMembers).values({ listId: list.id, userId, role: "OWNER" }).run();
    tx.insert(categories)
      .values({
        id: createId(),
        listId: list.id,
        title: DEFAULT_CATEGORY_TITLE,
        color: DEFAULT_CATEGORY_COLOR,
        sortOrder: 0,
      })
      .run();
    return {
      id: list.id,
      title: list.title,
      role: "OWNER" as const,
      itemCounts: { toBuy: 0, bought: 0 },
    };
  });
}

export function getListDetail(db: Db, listId: string): ListDetail {
  const list = db.select().from(groceryLists).where(eq(groceryLists.id, listId)).get();
  if (!list) {
    throw listNotFound(listId);
  }
  const owner = db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.id, list.ownerId))
    .get();
  if (!owner) {
    throw new FastifyHttpError(500, "INTERNAL_ERROR", "List owner record is missing");
  }
  const members = db
    .select({ userId: listMembers.userId, email: users.email, role: listMembers.role })
    .from(listMembers)
    .innerJoin(users, eq(listMembers.userId, users.id))
    .where(eq(listMembers.listId, listId))
    .all()
    .sort((a, b) => roleRank(b.role) - roleRank(a.role) || a.email.localeCompare(b.email));
  return { id: list.id, title: list.title, owner, members };
}

export function renameList(db: Db, listId: string, title: string): void {
  const result = db.update(groceryLists).set({ title }).where(eq(groceryLists.id, listId)).run();
  if (result.changes === 0) {
    throw listNotFound(listId);
  }
}

/** Deletes the list; members/categories/items/observations cascade (schema FKs). */
export function deleteList(db: Db, listId: string): void {
  const result = db.delete(groceryLists).where(eq(groceryLists.id, listId)).run();
  if (result.changes === 0) {
    throw listNotFound(listId);
  }
}

export function addListMember(db: Db, listId: string, email: string, role: ListRole): ListMember {
  const user = db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, email))
    .get();
  if (!user) {
    throw new FastifyHttpError(404, "NOT_FOUND", `No user with email ${email}`);
  }
  if (getMembership(db, listId, user.id)) {
    throw new FastifyHttpError(409, "CONFLICT", "User is already a member of this list");
  }
  db.insert(listMembers).values({ listId, userId: user.id, role }).run();
  return { userId: user.id, email: user.email, role };
}

export function updateListMemberRole(
  db: Db,
  listId: string,
  userId: string,
  role: ListRole,
): ListMember {
  const list = db
    .select({ ownerId: groceryLists.ownerId })
    .from(groceryLists)
    .where(eq(groceryLists.id, listId))
    .get();
  if (!list) {
    throw listNotFound(listId);
  }
  // The creator's membership must stay OWNER — it is what keeps list.ownerId
  // consistent with the members table.
  if (userId === list.ownerId && role !== "OWNER") {
    throw new FastifyHttpError(409, "CONFLICT", "The role of the list owner cannot be changed");
  }
  const updated = db
    .update(listMembers)
    .set({ role })
    .where(and(eq(listMembers.listId, listId), eq(listMembers.userId, userId)))
    .returning({ role: listMembers.role })
    .get();
  if (!updated) {
    throw new FastifyHttpError(404, "NOT_FOUND", "User is not a member of this list");
  }
  const email = db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .get()?.email;
  if (!email) {
    throw new FastifyHttpError(500, "INTERNAL_ERROR", "Member user record is missing");
  }
  return { userId, email, role: updated.role };
}

export function removeListMember(db: Db, listId: string, userId: string): void {
  const list = db
    .select({ ownerId: groceryLists.ownerId })
    .from(groceryLists)
    .where(eq(groceryLists.id, listId))
    .get();
  if (!list) {
    throw listNotFound(listId);
  }
  if (userId === list.ownerId) {
    throw new FastifyHttpError(409, "CONFLICT", "The list owner cannot be removed");
  }
  const result = db
    .delete(listMembers)
    .where(and(eq(listMembers.listId, listId), eq(listMembers.userId, userId)))
    .run();
  if (result.changes === 0) {
    throw new FastifyHttpError(404, "NOT_FOUND", "User is not a member of this list");
  }
}
