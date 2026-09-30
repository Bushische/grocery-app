import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  OAUTH_ACCESS_TTL_SECONDS,
  OAUTH_CODE_TTL_SECONDS,
  OAUTH_REFRESH_TTL_SECONDS,
  OAUTH_SCOPE_ALICE,
} from "@grocery/shared";
import { createId } from "@paralleldrive/cuid2";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { oauthClients, oauthCodes, oauthTokens, users } from "../db/schema";
import { FastifyHttpError } from "../errors";
import { hashToken } from "../services/authService";

export type OAuthClientRow = typeof oauthClients.$inferSelect;
export type OAuthCodeRow = typeof oauthCodes.$inferSelect;
export type OAuthTokenRow = typeof oauthTokens.$inferSelect;

export type IssuedAuthorizationCode = { code: string; expiresAt: Date };
export type CodeBinding = { userId: string; clientId: string; scope: string };
export type IssuedTokenPair = {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
  /** Seconds until the access token expires (Yandex `expires_in`). */
  expiresIn: number;
};
export type ValidatedAccessToken = { userId: string; clientId: string; scope: string };
export type RefreshedTokenPair = IssuedTokenPair & CodeBinding;

const unauthorized = (message: string) => new FastifyHttpError(401, "UNAUTHORIZED", message);
const notFound = (message: string) => new FastifyHttpError(404, "NOT_FOUND", message);
const validationError = (message: string) => new FastifyHttpError(400, "VALIDATION_ERROR", message);

/** Single-use authorization code: 32 random bytes, base64url-encoded. */
export function signAuthorizationCode(): string {
  return randomBytes(32).toString("base64url");
}

/** Access token: 32 random bytes, base64url-encoded (well under Yandex's 2048-char limit). */
export function signOAuthAccessToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Refresh token: 48 random bytes, base64url-encoded (mirrors `authService.signRefreshToken`). */
export function signOAuthRefreshToken(): string {
  return randomBytes(48).toString("base64url");
}

function requireScope(scope: string): void {
  if (scope !== OAUTH_SCOPE_ALICE) {
    throw validationError(`Unsupported scope "${scope}"`);
  }
}

function requireClient(db: Db, clientId: string): OAuthClientRow {
  const client = db.select().from(oauthClients).where(eq(oauthClients.id, clientId)).get();
  if (!client) {
    throw notFound(`OAuth client ${clientId} not found`);
  }
  return client;
}

function requireUserId(db: Db, userId: string): void {
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) {
    throw notFound(`User ${userId} not found`);
  }
}

/**
 * Registers (or re-keys) an OAuth client; only the sha256 hash of the secret
 * is persisted, never the plaintext. Deploy calls this at boot with the
 * secret from `.env` so the migration-seeded dev hash is replaced in prod.
 */
export function upsertOAuthClient(db: Db, clientId: string, clientSecret: string): OAuthClientRow {
  if (!clientId || !clientSecret) {
    throw validationError("clientId and clientSecret must not be empty");
  }
  const secretHash = hashToken(clientSecret);
  return db
    .insert(oauthClients)
    .values({ id: clientId, secretHash })
    .onConflictDoUpdate({ target: oauthClients.id, set: { secretHash } })
    .returning()
    .get();
}

/**
 * Authenticates an OAuth client by id + secret (token-endpoint client auth).
 * Returns the client row on success, null for unknown ids or wrong secrets.
 */
export function verifyOAuthClient(
  db: Db,
  clientId: string,
  clientSecret: string,
): OAuthClientRow | null {
  const client = db.select().from(oauthClients).where(eq(oauthClients.id, clientId)).get();
  if (!client) return null;
  const expected = Buffer.from(client.secretHash, "hex");
  const presented = Buffer.from(hashToken(clientSecret), "hex");
  if (expected.length !== presented.length) return null;
  return timingSafeEqual(expected, presented) ? client : null;
}

/**
 * Issues a single-use authorization code bound to (clientId, userId, scope).
 * Only the sha256 hash is persisted; the code expires after 10 minutes.
 */
export function issueAuthorizationCode(
  db: Db,
  params: { userId: string; clientId: string; scope?: string },
): IssuedAuthorizationCode {
  const scope = params.scope ?? OAUTH_SCOPE_ALICE;
  requireScope(scope);
  requireClient(db, params.clientId);
  requireUserId(db, params.userId);
  const code = signAuthorizationCode();
  const expiresAt = new Date(Date.now() + OAUTH_CODE_TTL_SECONDS * 1000);
  db.insert(oauthCodes)
    .values({
      id: createId(),
      clientId: params.clientId,
      userId: params.userId,
      codeHash: hashToken(code),
      scope,
      expiresAt,
    })
    .run();
  return { code, expiresAt };
}

/**
 * Redeems an authorization code exactly once: marks it used and returns the
 * (userId, clientId, scope) binding. Unknown, foreign-client, already-used,
 * and expired codes are rejected with 401 UNAUTHORIZED.
 */
export function consumeAuthorizationCode(
  db: Db,
  params: { code: string; clientId: string },
): CodeBinding {
  return db.transaction((tx) => {
    const row = tx
      .select()
      .from(oauthCodes)
      .where(eq(oauthCodes.codeHash, hashToken(params.code)))
      .get();
    if (!row || row.clientId !== params.clientId) {
      throw unauthorized("Invalid authorization code");
    }
    if (row.usedAt !== null) {
      throw unauthorized("Authorization code already used");
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      tx.delete(oauthCodes).where(eq(oauthCodes.id, row.id)).run();
      throw unauthorized("Authorization code expired");
    }
    tx.update(oauthCodes).set({ usedAt: new Date() }).where(eq(oauthCodes.id, row.id)).run();
    return { userId: row.userId, clientId: row.clientId, scope: row.scope };
  });
}

/**
 * Issues an access + refresh token pair; only the sha256 hashes are
 * persisted (never the plaintext). Access TTL 30 d, refresh TTL 1 y.
 */
export function issueTokenPair(
  db: Db,
  params: { userId: string; clientId: string; scope?: string },
): IssuedTokenPair {
  const scope = params.scope ?? OAUTH_SCOPE_ALICE;
  requireScope(scope);
  requireClient(db, params.clientId);
  requireUserId(db, params.userId);
  const accessToken = signOAuthAccessToken();
  const refreshToken = signOAuthRefreshToken();
  const accessExpiresAt = new Date(Date.now() + OAUTH_ACCESS_TTL_SECONDS * 1000);
  const refreshExpiresAt = new Date(Date.now() + OAUTH_REFRESH_TTL_SECONDS * 1000);
  db.insert(oauthTokens)
    .values({
      id: createId(),
      userId: params.userId,
      clientId: params.clientId,
      scope,
      accessTokenHash: hashToken(accessToken),
      refreshTokenHash: hashToken(refreshToken),
      accessExpiresAt,
      refreshExpiresAt,
    })
    .run();
  return {
    accessToken,
    refreshToken,
    accessExpiresAt,
    refreshExpiresAt,
    expiresIn: OAUTH_ACCESS_TTL_SECONDS,
  };
}

/**
 * Validates a presented access token (Alice webhook auth): resolves the
 * sha256 hash and returns the (userId, clientId, scope) binding — or null
 * when the token is unknown, expired, revoked, or orphaned.
 */
export function validateAccessToken(db: Db, presented: string): ValidatedAccessToken | null {
  const row = db
    .select()
    .from(oauthTokens)
    .where(eq(oauthTokens.accessTokenHash, hashToken(presented)))
    .get();
  if (!row || row.revokedAt !== null) return null;
  if (row.accessExpiresAt.getTime() <= Date.now()) return null;
  const user = db.select().from(users).where(eq(users.id, row.userId)).get();
  if (!user) return null;
  return { userId: row.userId, clientId: row.clientId, scope: row.scope };
}

/**
 * Rotates a refresh token: the old pair is revoked (replaying the old
 * refresh token or reusing the old access token is rejected) and a fresh
 * pair is issued atomically. Unknown, revoked, and expired refresh tokens
 * are rejected with 401 UNAUTHORIZED.
 */
export function refreshTokenPair(
  db: Db,
  params: { refreshToken: string; clientId: string },
): RefreshedTokenPair {
  return db.transaction((tx) => {
    const row = tx
      .select()
      .from(oauthTokens)
      .where(eq(oauthTokens.refreshTokenHash, hashToken(params.refreshToken)))
      .get();
    if (!row || row.clientId !== params.clientId || row.revokedAt !== null) {
      throw unauthorized("Invalid refresh token");
    }
    const expired = row.refreshExpiresAt.getTime() <= Date.now();
    const user = expired
      ? undefined
      : tx.select().from(users).where(eq(users.id, row.userId)).get();
    if (!user) {
      tx.update(oauthTokens).set({ revokedAt: new Date() }).where(eq(oauthTokens.id, row.id)).run();
      throw unauthorized(expired ? "Refresh token expired" : "Invalid refresh token");
    }
    tx.update(oauthTokens).set({ revokedAt: new Date() }).where(eq(oauthTokens.id, row.id)).run();
    const pair = issueTokenPair(tx, {
      userId: row.userId,
      clientId: row.clientId,
      scope: row.scope,
    });
    return { ...pair, userId: row.userId, clientId: row.clientId, scope: row.scope };
  });
}

/**
 * Revokes the pair carrying the presented access or refresh token (account
 * unlink); unknown tokens are ignored. Revoked pairs fail all later
 * validation and rotation.
 */
export function revokeOAuthToken(db: Db, presented: string): void {
  const hash = hashToken(presented);
  const byAccess = db
    .select({ id: oauthTokens.id })
    .from(oauthTokens)
    .where(eq(oauthTokens.accessTokenHash, hash))
    .get();
  const target =
    byAccess ??
    db
      .select({ id: oauthTokens.id })
      .from(oauthTokens)
      .where(eq(oauthTokens.refreshTokenHash, hash))
      .get();
  if (!target) return;
  db.update(oauthTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(oauthTokens.id, target.id), isNull(oauthTokens.revokedAt)))
    .run();
}

/** Revokes every live pair of a user (optionally scoped to one client); returns the count revoked. */
export function revokeAllUserOAuthTokens(db: Db, userId: string, clientId?: string): number {
  const conditions =
    clientId === undefined
      ? and(eq(oauthTokens.userId, userId), isNull(oauthTokens.revokedAt))
      : and(
          eq(oauthTokens.userId, userId),
          eq(oauthTokens.clientId, clientId),
          isNull(oauthTokens.revokedAt),
        );
  return db.update(oauthTokens).set({ revokedAt: new Date() }).where(conditions).run().changes;
}
