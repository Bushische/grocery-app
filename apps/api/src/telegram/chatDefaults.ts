import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { groceryLists, telegramChatDefaults, users } from "../db/schema";
import { FastifyHttpError } from "../errors";

export type TelegramChatDefaultRow = typeof telegramChatDefaults.$inferSelect;

const notFound = (message: string) => new FastifyHttpError(404, "NOT_FOUND", message);

/**
 * Per-chat shared default list (T68): one remembered list per Telegram chat,
 * visible to everyone in it. Last writer wins; the setter id is stored for
 * the "X switched this chat to …" announce. Titles are NOT secret — access
 * is enforced at execution time, not here.
 */
export function getChatDefault(db: Db, chatId: string): TelegramChatDefaultRow | null {
  const row =
    db.select().from(telegramChatDefaults).where(eq(telegramChatDefaults.chatId, chatId)).get() ??
    null;
  if (!row) return null;
  // Stale (list deleted without cascade, e.g. raw SQL): clean up, read as unset.
  const list = db.select().from(groceryLists).where(eq(groceryLists.id, row.listId)).get();
  if (!list) {
    clearChatDefault(db, chatId);
    return null;
  }
  return row;
}

/** Stores (upserts) the chat's shared default; last writer wins. */
export function setChatDefault(
  db: Db,
  chatId: string,
  listId: string,
  setByUserId: string,
): TelegramChatDefaultRow {
  const list = db.select().from(groceryLists).where(eq(groceryLists.id, listId)).get();
  if (!list) {
    throw notFound(`List ${listId} not found`);
  }
  const setter = db.select().from(users).where(eq(users.id, setByUserId)).get();
  if (!setter) {
    throw notFound(`User ${setByUserId} not found`);
  }
  return db
    .insert(telegramChatDefaults)
    .values({ chatId, listId, setByUserId })
    .onConflictDoUpdate({
      target: telegramChatDefaults.chatId,
      set: { listId, setByUserId, updatedAt: new Date() },
    })
    .returning()
    .get();
}

/** Drops the chat default (stale cleanup, idempotent). */
export function clearChatDefault(db: Db, chatId: string): void {
  db.delete(telegramChatDefaults).where(eq(telegramChatDefaults.chatId, chatId)).run();
}

export type ChatDefaultWithTitle = {
  chatId: string;
  listId: string;
  title: string;
  setByUserId: string;
};

/**
 * Reads the chat default with its title (titles are NOT secret — shown
 * unfiltered; access is enforced at execution). Null when unset or stale
 * (stale rows are cleaned, like getChatDefault).
 */
export function getChatDefaultWithTitle(db: Db, chatId: string): ChatDefaultWithTitle | null {
  const row = getChatDefault(db, chatId);
  if (!row) return null;
  const list = db.select().from(groceryLists).where(eq(groceryLists.id, row.listId)).get();
  if (!list) {
    clearChatDefault(db, chatId);
    return null;
  }
  return {
    chatId: row.chatId,
    listId: row.listId,
    title: list.title,
    setByUserId: row.setByUserId,
  };
}
