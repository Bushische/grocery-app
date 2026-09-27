import { API_TOKEN_PREFIX, type ApiToken, type ApiTokenCreated } from "@grocery/shared";
import { createId } from "@paralleldrive/cuid2";
import { hashSync } from "bcryptjs";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { loadConfig } from "../config";
import { type Db, createDb, createSqlite } from "../db/client";
import { runMigrations } from "../db/migrate";
import { apiTokens, users } from "../db/schema";

const OWNER = { email: "owner@example.com", password: "owner-password" };
const VIEWER = { email: "viewer@example.com", password: "viewer-password" };
const OUTSIDER = { email: "outsider@example.com", password: "outsider-password" };

const ALL_USERS = [OWNER, VIEWER, OUTSIDER];

let app: FastifyInstance;
let db: Db;
let ownerToken: string;
let viewerToken: string;
let listId: string;

function buildTestApp(): { app: FastifyInstance; db: Db } {
  const sqlite = createSqlite(":memory:");
  const database = createDb(sqlite);
  runMigrations(database);
  const built = buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent" }), {
    db: database,
  });
  return { app: built, db: database };
}

function bearer(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

async function accessTokenOf(email: string, password: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email, password },
  });
  expect(res.statusCode).toBe(200);
  return res.json().accessToken;
}

async function createApiToken(
  token: string,
  name: string,
): Promise<{ res: Awaited<ReturnType<FastifyInstance["inject"]>>; body: ApiTokenCreated }> {
  const res = await app.inject({
    method: "POST",
    url: "/api-tokens",
    headers: bearer(token),
    payload: { name },
  });
  return {
    res,
    body: res.statusCode === 201 ? (res.json() as ApiTokenCreated) : ({} as ApiTokenCreated),
  };
}

beforeAll(async () => {
  ({ app, db } = buildTestApp());
  db.insert(users)
    .values(
      ALL_USERS.map((user) => ({
        id: createId(),
        email: user.email,
        passwordHash: hashSync(user.password, 10),
        role: "user" as const,
      })),
    )
    .run();
  ownerToken = await accessTokenOf(OWNER.email, OWNER.password);
  viewerToken = await accessTokenOf(VIEWER.email, VIEWER.password);
  const listRes = await app.inject({
    method: "POST",
    url: "/lists",
    headers: bearer(ownerToken),
    payload: { title: "Tokens" },
  });
  expect(listRes.statusCode).toBe(201);
  listId = listRes.json().id as string;
  const memberRes = await app.inject({
    method: "POST",
    url: `/lists/${listId}/members`,
    headers: bearer(ownerToken),
    payload: { email: VIEWER.email, role: "VIEWER" },
  });
  expect(memberRes.statusCode).toBe(201);
});

describe("POST /api-tokens", () => {
  it("issues a glc_ token, shown exactly once, with only its sha256 hash stored", async () => {
    const { res, body } = await createApiToken(ownerToken, "ai-agent");
    expect(res.statusCode).toBe(201);
    expect(Object.keys(body).sort()).toEqual(["id", "token"]);
    expect(body.token.startsWith(API_TOKEN_PREFIX)).toBe(true);
    expect(body.token.length).toBeGreaterThan(API_TOKEN_PREFIX.length + 32);

    const stored = db.select().from(apiTokens).where(eq(apiTokens.id, body.id)).all();
    expect(stored).toHaveLength(1);
    const [row] = stored;
    if (!row) throw new Error("token row missing");
    expect(row.name).toBe("ai-agent");
    expect(row.lastUsedAt).toBeNull();
    // The plaintext never lands in any stored column.
    const rows = db.select().from(apiTokens).all();
    for (const candidate of rows) {
      expect(JSON.stringify(candidate)).not.toContain(body.token);
    }
    // The hash corresponds to the plaintext token.
    const { createHash } = await import("node:crypto");
    const tokenHash = createHash("sha256").update(body.token).digest("hex");
    expect(row.tokenHash).toBe(tokenHash);
  });

  it("rejects a blank name and missing auth", async () => {
    expect((await createApiToken(ownerToken, "  ")).res.statusCode).toBe(400);
    const noAuth = await app.inject({ method: "POST", url: "/api-tokens", payload: { name: "x" } });
    expect(noAuth.statusCode).toBe(401);
  });
});

describe("created token authorizes endpoints as its owner", () => {
  it("calls item endpoints with the owner's permissions", async () => {
    const { body } = await createApiToken(ownerToken, "item-agent");
    const createRes = await app.inject({
      method: "POST",
      url: `/lists/${listId}/items`,
      headers: bearer(body.token),
      payload: { title: "Milk" },
    });
    expect(createRes.statusCode).toBe(201);
    expect(createRes.json().title).toBe("Milk");

    const listRes = await app.inject({
      method: "GET",
      url: `/lists/${listId}/items`,
      headers: bearer(body.token),
    });
    expect(listRes.statusCode).toBe(200);

    const meRes = await app.inject({ method: "GET", url: "/me", headers: bearer(body.token) });
    expect(meRes.statusCode).toBe(200);
    expect(meRes.json().email).toBe(OWNER.email);
  });

  it("applies the owner's list role (a VIEWER's token cannot mutate)", async () => {
    const { body } = await createApiToken(viewerToken, "viewer-agent");
    const createRes = await app.inject({
      method: "POST",
      url: `/lists/${listId}/items`,
      headers: bearer(body.token),
      payload: { title: "Nope" },
    });
    expect(createRes.statusCode).toBe(403);
    expect(createRes.json().error.code).toBe("FORBIDDEN");
  });
});

describe("GET /api-tokens", () => {
  it("lists only the caller's tokens and bumps lastUsedAt on use", async () => {
    const mine = await createApiToken(ownerToken, "listed-agent");
    await createApiToken(viewerToken, "foreign-agent");

    const before = await app.inject({
      method: "GET",
      url: "/api-tokens",
      headers: bearer(ownerToken),
    });
    expect(before.statusCode).toBe(200);
    const listed = before.json() as ApiToken[];
    expect(listed.some((row) => row.id === mine.body.id)).toBe(true);
    expect(listed.every((row) => !("token" in row) && !("tokenHash" in row))).toBe(true);
    expect(listed.find((row) => row.id === mine.body.id)?.lastUsedAt).toBeNull();

    // Using the token authorizes a request and bumps lastUsedAt.
    await app.inject({ method: "GET", url: "/lists", headers: bearer(mine.body.token) });
    const after = await app.inject({
      method: "GET",
      url: "/api-tokens",
      headers: bearer(ownerToken),
    });
    const afterListed = after.json() as ApiToken[];
    const used = afterListed.find((row) => row.id === mine.body.id);
    expect(used?.lastUsedAt).not.toBeNull();
    if (used?.lastUsedAt) {
      expect(Math.abs(Date.parse(used.lastUsedAt) - Date.now())).toBeLessThan(60_000);
    }
  });

  it("requires auth", async () => {
    expect((await app.inject({ method: "GET", url: "/api-tokens" })).statusCode).toBe(401);
  });
});

describe("DELETE /api-tokens/:id", () => {
  it("revokes the token — it stops authorizing immediately", async () => {
    const { body } = await createApiToken(ownerToken, "short-lived");
    const authHeader = bearer(body.token);
    expect(
      (await app.inject({ method: "GET", url: "/lists", headers: authHeader })).statusCode,
    ).toBe(200);

    const delRes = await app.inject({
      method: "DELETE",
      url: `/api-tokens/${body.id}`,
      headers: bearer(ownerToken),
    });
    expect(delRes.statusCode).toBe(204);

    const revoked = await app.inject({
      method: "GET",
      url: "/lists",
      headers: bearer(body.token),
    });
    expect(revoked.statusCode).toBe(401);
    expect(revoked.json().error.code).toBe("UNAUTHORIZED");
  });

  it("404s for unknown ids and other users' tokens", async () => {
    const foreign = await createApiToken(viewerToken, "foreign");
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: "/api-tokens/does-not-exist",
          headers: bearer(ownerToken),
        })
      ).statusCode,
    ).toBe(404);
    // The owner cannot revoke another user's token.
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api-tokens/${foreign.body.id}`,
          headers: bearer(ownerToken),
        })
      ).statusCode,
    ).toBe(404);
    // ...and that foreign token still works for its owner.
    expect(
      (await app.inject({ method: "GET", url: "/lists", headers: bearer(foreign.body.token) }))
        .statusCode,
    ).toBe(200);
  });

  it("requires auth", async () => {
    const res = await app.inject({ method: "DELETE", url: "/api-tokens/whatever" });
    expect(res.statusCode).toBe(401);
  });
});

describe("token security", () => {
  it("rejects a garbage glc_ token with 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/lists",
      headers: bearer(`${API_TOKEN_PREFIX}not-a-real-token`),
    });
    expect(res.statusCode).toBe(401);
  });
});
