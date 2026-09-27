import { createHash, randomBytes } from "node:crypto";
import { REFRESH_TTL_SECONDS } from "@grocery/shared";
import { createId } from "@paralleldrive/cuid2";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { refreshTokens, users } from "../db/schema";
import { FastifyHttpError } from "../errors";

export type User = typeof users.$inferSelect;
export type IssuedRefreshToken = { token: string; expiresAt: Date };

const unauthorized = (message: string) => new FastifyHttpError(401, "UNAUTHORIZED", message);

/**
 * Constant bcrypt target burned when the email does not exist, so login
 * timing does not reveal whether an email is registered.
 */
const TIMING_EQUALIZER_HASH = bcrypt.hashSync("grocery-list-timing-equalizer", 10);

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function signRefreshToken(): string {
  return randomBytes(48).toString("base64url");
}

/** Issues a 30-day refresh token; only its sha256 hash is persisted. */
export function issueRefreshToken(db: Db, userId: string): IssuedRefreshToken {
  const token = signRefreshToken();
  const expiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);
  db.insert(refreshTokens)
    .values({ id: createId(), userId, tokenHash: hashToken(token), expiresAt })
    .run();
  return { token, expiresAt };
}

/**
 * Verifies email + password (bcrypt). Throws 401 UNAUTHORIZED with the same
 * message for unknown emails and wrong passwords.
 */
export async function authenticate(db: Db, email: string, password: string): Promise<User> {
  const user = db.select().from(users).where(eq(users.email, email)).get();
  if (!user) {
    await bcrypt.compare(password, TIMING_EQUALIZER_HASH);
    throw unauthorized("Invalid email or password");
  }
  const passwordOk = await bcrypt.compare(password, user.passwordHash);
  if (!passwordOk) {
    throw unauthorized("Invalid email or password");
  }
  return user;
}

export type RotationResult = { user: User; refreshToken: IssuedRefreshToken };

/**
 * Consumes a presented refresh token and returns a new one (rotation per
 * docs/API.md → Auth): the presented token is revoked — so replaying the old
 * cookie is rejected — and a fresh 30-day token is issued atomically.
 */
export function rotateRefreshToken(db: Db, presented: string): RotationResult {
  const tokenHash = hashToken(presented);
  const row = db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, tokenHash)).get();
  if (!row) {
    throw unauthorized("Invalid refresh token");
  }
  const expired = row.expiresAt.getTime() <= Date.now();
  const user = expired ? undefined : db.select().from(users).where(eq(users.id, row.userId)).get();
  if (!user) {
    db.delete(refreshTokens).where(eq(refreshTokens.id, row.id)).run();
    throw unauthorized(expired ? "Refresh token expired" : "Invalid refresh token");
  }
  return db.transaction((tx) => {
    tx.delete(refreshTokens).where(eq(refreshTokens.id, row.id)).run();
    const refreshToken = issueRefreshToken(tx, user.id);
    return { user, refreshToken };
  });
}

/** Revokes a presented refresh token (logout); unknown tokens are ignored. */
export function revokeRefreshToken(db: Db, presented: string): void {
  db.delete(refreshTokens)
    .where(eq(refreshTokens.tokenHash, hashToken(presented)))
    .run();
}
