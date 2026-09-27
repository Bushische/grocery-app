import { randomBytes } from "node:crypto";
import { API_TOKEN_PREFIX } from "@grocery/shared";
import { createId } from "@paralleldrive/cuid2";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { apiTokens, users } from "../db/schema";
import { FastifyHttpError } from "../errors";
import { hashToken } from "./authService";

export type ApiTokenRow = typeof apiTokens.$inferSelect;
export type User = typeof users.$inferSelect;

/** Plaintext token: `glc_` + 32 random bytes, base64url-encoded. */
export function signApiToken(): string {
  return `${API_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/** Creates a token for the user; only its sha256 hash is persisted (never the plaintext). */
export function createApiToken(
  db: Db,
  userId: string,
  name: string,
): { id: string; token: string } {
  const token = signApiToken();
  const id = createId();
  db.insert(apiTokens)
    .values({ id, userId, tokenHash: hashToken(token), name })
    .run();
  return { id, token };
}

/** Lists the caller's tokens (metadata only — no plaintext is ever returned). */
export function listApiTokens(db: Db, userId: string): ApiTokenRow[] {
  return db
    .select()
    .from(apiTokens)
    .where(eq(apiTokens.userId, userId))
    .all()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/** Revokes one of the user's tokens; unknown or foreign ids → 404. */
export function revokeApiToken(db: Db, userId: string, tokenId: string): void {
  const result = db
    .delete(apiTokens)
    .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.userId, userId)))
    .run();
  if (result.changes === 0) {
    throw new FastifyHttpError(404, "NOT_FOUND", `API token ${tokenId} not found`);
  }
}

/**
 * Authenticates a `glc_…` Bearer token (docs/API.md → Conventions): resolves
 * the sha256 hash, bumps `lastUsedAt`, and returns the owning user — or null
 * when the token is unknown/revoked. API tokens never expire.
 */
export function authenticateApiToken(db: Db, presented: string): User | null {
  const row = db
    .select()
    .from(apiTokens)
    .where(eq(apiTokens.tokenHash, hashToken(presented)))
    .get();
  if (!row) return null;
  const user = db.select().from(users).where(eq(users.id, row.userId)).get();
  if (!user) return null;
  db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, row.id)).run();
  return user;
}
