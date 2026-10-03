import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { telegramLinks, users } from "../db/schema";
import { FastifyHttpError } from "../errors";

export type TelegramLinkRow = typeof telegramLinks.$inferSelect;

const notFound = (message: string) => new FastifyHttpError(404, "NOT_FOUND", message);

/**
 * Telegram→user link storage (docs/TELEGRAM_PLAN.md → §2). Independent of
 * `alice_links` / `oauth_*`: the same email user can hold both links at once.
 * `telegram_id` is Telegram's public numeric identifier, stored as TEXT as-is.
 */
export function getTelegramLinkByTelegramId(db: Db, telegramId: string): TelegramLinkRow | null {
  return (
    db.select().from(telegramLinks).where(eq(telegramLinks.telegramId, telegramId)).get() ?? null
  );
}

export function getTelegramLinkByUserId(db: Db, userId: string): TelegramLinkRow | null {
  return db.select().from(telegramLinks).where(eq(telegramLinks.userId, userId)).get() ?? null;
}

/**
 * Links a Telegram id to a user, RE-ASSIGNING by default (TELEGRAM_PLAN Q3):
 * when the same `telegram_id` is already linked to another user, the link
 * MOVES to the newly authenticated user — no 409 dead-end; the previous user
 * simply gets `NOT_FOUND` on their next session attempt and can re-link.
 * Exactly one row per user and one row per telegram_id is preserved.
 */
export function linkTelegramAccount(db: Db, userId: string, telegramId: string): TelegramLinkRow {
  if (!telegramId) {
    throw new FastifyHttpError(400, "VALIDATION_ERROR", "telegramId must not be empty");
  }
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) {
    throw notFound(`User ${userId} not found`);
  }
  return db.transaction((tx) => {
    // Drop any row carrying this telegram_id (another user's link moves here).
    tx.delete(telegramLinks).where(eq(telegramLinks.telegramId, telegramId)).run();
    return tx
      .insert(telegramLinks)
      .values({ userId, telegramId })
      .onConflictDoUpdate({ target: telegramLinks.userId, set: { telegramId } })
      .returning()
      .get();
  });
}

/** Removes the caller's Telegram link (revoke/unlink); unknown links are ignored. */
export function unlinkTelegramAccount(db: Db, userId: string): void {
  db.delete(telegramLinks).where(eq(telegramLinks.userId, userId)).run();
}
