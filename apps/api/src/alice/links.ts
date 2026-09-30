import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { aliceLinks } from "../db/schema";
import { getMembership, listListsForUser } from "../services/listService";

export type AliceListChoice = { id: string; title: string };

export type AliceListBinding =
  | { kind: "bound"; listId: string }
  | { kind: "need_choice"; lists: AliceListChoice[] }
  | { kind: "no_lists" };

/** Returns the bound list id for the user, if any. */
export function getAliceLink(db: Db, userId: string): string | undefined {
  return db.select().from(aliceLinks).where(eq(aliceLinks.userId, userId)).get()?.listId;
}

/** Persists the single-list binding (upsert — one row per user). */
export function setAliceLink(db: Db, userId: string, listId: string): void {
  db.insert(aliceLinks)
    .values({ userId, listId })
    .onConflictDoUpdate({ target: aliceLinks.userId, set: { listId } })
    .run();
}

/** Drops the binding (used when the bound list becomes inaccessible). */
export function clearAliceLink(db: Db, userId: string): void {
  db.delete(aliceLinks).where(eq(aliceLinks.userId, userId)).run();
}

/**
 * Resolves the user's Alice list (docs/ALICE_PLAN.md → webhook section):
 * a stored binding is reused only while its list still exists AND the user
 * is still a member (existing guards apply); otherwise the binding is
 * dropped and re-derived — exactly one accessible list binds silently,
 * several ask once via `session_state`, zero report `no_lists`.
 */
export function ensureAliceList(db: Db, userId: string): AliceListBinding {
  const stored = getAliceLink(db, userId);
  if (stored !== undefined) {
    if (getMembership(db, stored, userId) !== undefined) {
      return { kind: "bound", listId: stored };
    }
    clearAliceLink(db, userId);
  }
  const accessible = listListsForUser(db, userId);
  if (accessible.length === 0) {
    return { kind: "no_lists" };
  }
  if (accessible.length === 1) {
    const only = accessible[0];
    if (!only) return { kind: "no_lists" };
    setAliceLink(db, userId, only.id);
    return { kind: "bound", listId: only.id };
  }
  return {
    kind: "need_choice",
    lists: accessible.map((list) => ({ id: list.id, title: list.title })),
  };
}

/**
 * Matches a spoken answer against candidate list titles (case-insensitive,
 * `ё`/`е`-insensitive). Returns the matched list id, or undefined.
 */
export function matchListChoice(
  candidates: AliceListChoice[],
  utterance: string,
): string | undefined {
  const spoken = normalizeTitle(utterance);
  if (!spoken) return undefined;
  return candidates.find((candidate) => normalizeTitle(candidate.title) === spoken)?.id;
}

function normalizeTitle(value: string): string {
  return value.trim().toLowerCase().replaceAll("ё", "е");
}
