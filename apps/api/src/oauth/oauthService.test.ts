import {
  OAUTH_ACCESS_TTL_SECONDS,
  OAUTH_CLIENT_ALICE,
  OAUTH_CODE_TTL_SECONDS,
  OAUTH_REFRESH_TTL_SECONDS,
  OAUTH_SCOPE_ALICE,
} from "@grocery/shared";
import { createId } from "@paralleldrive/cuid2";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { type Db, createDb, createSqlite } from "../db/client";
import { runMigrations } from "../db/migrate";
import { oauthClients, oauthCodes, oauthTokens, users } from "../db/schema";
import { FastifyHttpError } from "../errors";
import { hashToken } from "../services/authService";
import {
  consumeAuthorizationCode,
  issueAuthorizationCode,
  issueTokenPair,
  refreshTokenPair,
  revokeAllUserOAuthTokens,
  revokeOAuthToken,
  upsertOAuthClient,
  validateAccessToken,
  verifyOAuthClient,
} from "./oauthService";

/** Dev-only placeholder whose sha256 is seeded by the 0002 migration — never a real secret. */
const SEEDED_DEV_SECRET = "alice-dev-secret-change-me";

let db: Db;
let userId: string;

function createUser(email: string): string {
  const id = createId();
  db.insert(users).values({ id, email, passwordHash: "dummy-hash", role: "user" }).run();
  return id;
}

function expectHttpError(fn: () => unknown, status: number, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(FastifyHttpError);
    expect((error as FastifyHttpError).status).toBe(status);
    expect((error as FastifyHttpError).code).toBe(code);
    return;
  }
  throw new Error(`expected FastifyHttpError ${status} ${code}`);
}

beforeAll(() => {
  const sqlite = createSqlite(":memory:");
  db = createDb(sqlite);
  runMigrations(db);
  userId = createUser("alice-user@example.com");
});

describe("oauth_clients (migration seed + client auth)", () => {
  it("is pre-seeded with the alice row holding only a secret hash", () => {
    const row = db.select().from(oauthClients).where(eq(oauthClients.id, "alice")).get();
    expect(row).toBeDefined();
    expect(row?.id).toBe(OAUTH_CLIENT_ALICE);
    expect(row?.secretHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row).not.toHaveProperty("secret");
    expect(row?.secretHash).toBe(hashToken(SEEDED_DEV_SECRET));
  });

  it("verifies the client secret and rejects wrong/unknown credentials", () => {
    expect(verifyOAuthClient(db, "alice", SEEDED_DEV_SECRET)?.id).toBe("alice");
    expect(verifyOAuthClient(db, "alice", "wrong-secret")).toBeNull();
    expect(verifyOAuthClient(db, "no-such-client", "whatever")).toBeNull();
  });

  it("upsertOAuthClient re-keys the secret with hash-only storage", () => {
    upsertOAuthClient(db, "alice", "brand-new-secret");
    expect(verifyOAuthClient(db, "alice", "brand-new-secret")?.id).toBe("alice");
    expect(verifyOAuthClient(db, "alice", SEEDED_DEV_SECRET)).toBeNull();
    const row = db.select().from(oauthClients).where(eq(oauthClients.id, "alice")).get();
    expect(row?.secretHash).toBe(hashToken("brand-new-secret"));
    // Restore the seeded secret so later suites see the migration state.
    upsertOAuthClient(db, "alice", SEEDED_DEV_SECRET);
  });

  it("rejects empty ids/secrets and unknown clients/users on issue", () => {
    expectHttpError(() => upsertOAuthClient(db, "", "x"), 400, "VALIDATION_ERROR");
    expectHttpError(() => upsertOAuthClient(db, "alice", ""), 400, "VALIDATION_ERROR");
    expectHttpError(
      () => issueAuthorizationCode(db, { userId, clientId: "no-such-client" }),
      404,
      "NOT_FOUND",
    );
    expectHttpError(
      () => issueAuthorizationCode(db, { userId: "no-such-user", clientId: "alice" }),
      404,
      "NOT_FOUND",
    );
    expectHttpError(
      () => issueAuthorizationCode(db, { userId, clientId: "alice", scope: "bogus" }),
      400,
      "VALIDATION_ERROR",
    );
  });
});

describe("authorization codes (single-use, 10-min TTL)", () => {
  it("issues a code redeemable exactly once with the user binding", () => {
    const { code, expiresAt } = issueAuthorizationCode(db, { userId, clientId: "alice" });
    expect(code.length).toBeGreaterThan(20);
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(0);
    expect(expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(OAUTH_CODE_TTL_SECONDS * 1000);

    const binding = consumeAuthorizationCode(db, { code, clientId: "alice" });
    expect(binding).toEqual({ userId, clientId: "alice", scope: OAUTH_SCOPE_ALICE });

    const stored = db
      .select()
      .from(oauthCodes)
      .where(eq(oauthCodes.codeHash, hashToken(code)))
      .get();
    expect(stored?.usedAt).toBeInstanceOf(Date);

    expectHttpError(
      () => consumeAuthorizationCode(db, { code, clientId: "alice" }),
      401,
      "UNAUTHORIZED",
    );
  });

  it("rejects unknown codes and codes presented to another client", () => {
    expectHttpError(
      () => consumeAuthorizationCode(db, { code: "never-issued", clientId: "alice" }),
      401,
      "UNAUTHORIZED",
    );
    upsertOAuthClient(db, "other-client", "other-secret");
    const { code } = issueAuthorizationCode(db, { userId, clientId: "alice" });
    expectHttpError(
      () => consumeAuthorizationCode(db, { code, clientId: "other-client" }),
      401,
      "UNAUTHORIZED",
    );
    // The code is still redeemable by the owning client afterwards.
    expect(consumeAuthorizationCode(db, { code, clientId: "alice" }).userId).toBe(userId);
  });

  it("rejects expired codes", () => {
    const { code } = issueAuthorizationCode(db, { userId, clientId: "alice" });
    db.update(oauthCodes)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(oauthCodes.codeHash, hashToken(code)))
      .run();
    expectHttpError(
      () => consumeAuthorizationCode(db, { code, clientId: "alice" }),
      401,
      "UNAUTHORIZED",
    );
  });

  it("persists only the sha256 hash of the code, never the plaintext", () => {
    const { code } = issueAuthorizationCode(db, { userId, clientId: "alice" });
    const stored = db
      .select()
      .from(oauthCodes)
      .where(eq(oauthCodes.codeHash, hashToken(code)))
      .get();
    expect(stored?.codeHash).toBe(hashToken(code));
    expect(stored?.codeHash).not.toBe(code);
    expect(db.select().from(oauthCodes).where(eq(oauthCodes.codeHash, code)).get()).toBeUndefined();
    consumeAuthorizationCode(db, { code, clientId: "alice" });
  });
});

describe("token pairs (30-d access, 1-y refresh)", () => {
  it("issues a pair whose access token validates to the user binding", () => {
    const pair = issueTokenPair(db, { userId, clientId: "alice" });
    expect(pair.expiresIn).toBe(OAUTH_ACCESS_TTL_SECONDS);
    expect(pair.accessToken.length).toBeLessThanOrEqual(2048);
    expect(pair.refreshToken.length).toBeLessThanOrEqual(2048);
    expect(pair.accessExpiresAt.getTime() - Date.now()).toBeLessThanOrEqual(
      OAUTH_ACCESS_TTL_SECONDS * 1000,
    );
    expect(pair.refreshExpiresAt.getTime() - Date.now()).toBeLessThanOrEqual(
      OAUTH_REFRESH_TTL_SECONDS * 1000,
    );
    expect(validateAccessToken(db, pair.accessToken)).toEqual({
      userId,
      clientId: "alice",
      scope: OAUTH_SCOPE_ALICE,
    });
  });

  it("rejects unknown and expired access tokens", () => {
    expect(validateAccessToken(db, "never-issued")).toBeNull();
    const pair = issueTokenPair(db, { userId, clientId: "alice" });
    db.update(oauthTokens)
      .set({ accessExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(oauthTokens.accessTokenHash, hashToken(pair.accessToken)))
      .run();
    expect(validateAccessToken(db, pair.accessToken)).toBeNull();
  });

  it("persists only sha256 hashes of both tokens, never the plaintext", () => {
    const pair = issueTokenPair(db, { userId, clientId: "alice" });
    const stored = db
      .select()
      .from(oauthTokens)
      .where(eq(oauthTokens.accessTokenHash, hashToken(pair.accessToken)))
      .get();
    expect(stored?.accessTokenHash).toBe(hashToken(pair.accessToken));
    expect(stored?.refreshTokenHash).toBe(hashToken(pair.refreshToken));
    for (const value of Object.values(stored ?? {})) {
      expect(value).not.toBe(pair.accessToken);
      expect(value).not.toBe(pair.refreshToken);
    }
    expect(
      db.select().from(oauthTokens).where(eq(oauthTokens.accessTokenHash, pair.accessToken)).get(),
    ).toBeUndefined();
  });

  it("rotation issues a fresh pair and invalidates the old one (replay rejected)", () => {
    const first = issueTokenPair(db, { userId, clientId: "alice" });
    const second = refreshTokenPair(db, { refreshToken: first.refreshToken, clientId: "alice" });
    expect(second.accessToken).not.toBe(first.accessToken);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(second.userId).toBe(userId);

    // Old access token is dead, new one validates.
    expect(validateAccessToken(db, first.accessToken)).toBeNull();
    expect(validateAccessToken(db, second.accessToken)?.userId).toBe(userId);

    // Replaying the old refresh token is rejected; the new one rotates again.
    expectHttpError(
      () => refreshTokenPair(db, { refreshToken: first.refreshToken, clientId: "alice" }),
      401,
      "UNAUTHORIZED",
    );
    const third = refreshTokenPair(db, { refreshToken: second.refreshToken, clientId: "alice" });
    expect(validateAccessToken(db, third.accessToken)?.userId).toBe(userId);
    expect(validateAccessToken(db, second.accessToken)).toBeNull();
  });

  it("rejects unknown, foreign-client, and expired refresh tokens", () => {
    expectHttpError(
      () => refreshTokenPair(db, { refreshToken: "never-issued", clientId: "alice" }),
      401,
      "UNAUTHORIZED",
    );
    const pair = issueTokenPair(db, { userId, clientId: "alice" });
    expectHttpError(
      () => refreshTokenPair(db, { refreshToken: pair.refreshToken, clientId: "other-client" }),
      401,
      "UNAUTHORIZED",
    );
    db.update(oauthTokens)
      .set({ refreshExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(oauthTokens.refreshTokenHash, hashToken(pair.refreshToken)))
      .run();
    expectHttpError(
      () => refreshTokenPair(db, { refreshToken: pair.refreshToken, clientId: "alice" }),
      401,
      "UNAUTHORIZED",
    );
  });

  it("revocation kills both the access token and the refresh rotation", () => {
    const pair = issueTokenPair(db, { userId, clientId: "alice" });
    revokeOAuthToken(db, pair.accessToken);
    expect(validateAccessToken(db, pair.accessToken)).toBeNull();
    expectHttpError(
      () => refreshTokenPair(db, { refreshToken: pair.refreshToken, clientId: "alice" }),
      401,
      "UNAUTHORIZED",
    );

    const other = issueTokenPair(db, { userId, clientId: "alice" });
    revokeOAuthToken(db, other.refreshToken);
    expect(validateAccessToken(db, other.accessToken)).toBeNull();
    expectHttpError(
      () => refreshTokenPair(db, { refreshToken: other.refreshToken, clientId: "alice" }),
      401,
      "UNAUTHORIZED",
    );

    // Unknown tokens are ignored (idempotent, no throw).
    revokeOAuthToken(db, "never-issued");
  });

  it("revokeAllUserOAuthTokens revokes every live pair of the user", () => {
    const firstUser = createUser("alice-second@example.com");
    const own = issueTokenPair(db, { userId, clientId: "alice" });
    const foreign = issueTokenPair(db, { userId: firstUser, clientId: "alice" });
    expect(revokeAllUserOAuthTokens(db, userId)).toBeGreaterThanOrEqual(1);
    expect(validateAccessToken(db, own.accessToken)).toBeNull();
    // Another user's pairs are untouched.
    expect(validateAccessToken(db, foreign.accessToken)?.userId).toBe(firstUser);
  });
});
