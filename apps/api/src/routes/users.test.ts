import type { UserDto } from "@grocery/shared";
import { createId } from "@paralleldrive/cuid2";
import { compareSync, hashSync } from "bcryptjs";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { loadConfig } from "../config";
import { type Db, createDb, createSqlite } from "../db/client";
import { runMigrations } from "../db/migrate";
import { users } from "../db/schema";

const ADMIN = { email: "admin@example.com", password: "admin-password" };
const PLAIN = { email: "plain@example.com", password: "plain-password" };
const OUTSIDER = { email: "outsider@example.com", password: "outsider-password" };

let app: FastifyInstance;
let db: Db;
let adminToken: string;
let plainToken: string;
let outsiderToken: string;
let adminId: string;
let plainId: string;

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

async function listOfUsers(token: string): Promise<{
  status: number;
  code?: string;
  body: UserDto[];
}> {
  const res = await app.inject({ method: "GET", url: "/users", headers: bearer(token) });
  return {
    status: res.statusCode,
    code: res.statusCode === 200 ? undefined : (res.json().error.code as string),
    body: res.statusCode === 200 ? (res.json() as UserDto[]) : [],
  };
}

beforeAll(async () => {
  ({ app, db } = buildTestApp());
  const inserted = db
    .insert(users)
    .values(
      [
        { ...ADMIN, role: "admin" as const },
        { ...PLAIN, role: "user" as const },
        { ...OUTSIDER, role: "user" as const },
      ].map((user) => ({
        id: createId(),
        email: user.email,
        passwordHash: hashSync(user.password, 10),
        role: user.role,
      })),
    )
    .returning({ id: users.id, email: users.email })
    .all();
  adminId = inserted.find((row) => row.email === ADMIN.email)!.id;
  plainId = inserted.find((row) => row.email === PLAIN.email)!.id;

  adminToken = await accessTokenOf(ADMIN.email, ADMIN.password);
  plainToken = await accessTokenOf(PLAIN.email, PLAIN.password);
  outsiderToken = await accessTokenOf(OUTSIDER.email, OUTSIDER.password);

  // PLAIN owns a list (DELETE /users → 409); OUTSIDER is an EDITOR of it
  // (per-list roles grant nothing on /users).
  const listRes = await app.inject({
    method: "POST",
    url: "/lists",
    headers: bearer(plainToken),
    payload: { title: "Plain's list" },
  });
  expect(listRes.statusCode).toBe(201);
  const memberRes = await app.inject({
    method: "POST",
    url: `/lists/${listRes.json().id as string}/members`,
    headers: bearer(plainToken),
    payload: { email: OUTSIDER.email, role: "EDITOR" },
  });
  expect(memberRes.statusCode).toBe(201);
});

describe("GET /users", () => {
  it("lists every user with id, email, role, createdAt", async () => {
    const { status, body } = await listOfUsers(adminToken);
    expect(status).toBe(200);
    expect(body.length).toBe(3);
    for (const row of body) {
      expect(Object.keys(row).sort()).toEqual(["createdAt", "email", "id", "role"]);
      expect(() => new Date(row.createdAt).toISOString()).not.toThrow();
    }
    const admin = body.find((row) => row.email === ADMIN.email);
    expect(admin?.role).toBe("admin");
    expect(admin?.id).toBe(adminId);
    expect(body.find((row) => row.email === PLAIN.email)?.role).toBe("user");
  });

  it("403s for non-admins — global role only, list roles grant nothing", async () => {
    expect(await listOfUsers(plainToken)).toMatchObject({ status: 403, code: "FORBIDDEN" });
    // OUTSIDER is an EDITOR of PLAIN's list — still 403.
    expect(await listOfUsers(outsiderToken)).toMatchObject({ status: 403, code: "FORBIDDEN" });
  });

  it("authorizes an admin API token (glc_)", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api-tokens",
      headers: bearer(adminToken),
      payload: { name: "admin-agent" },
    });
    expect(created.statusCode).toBe(201);
    const { status, body } = await listOfUsers(created.json().token as string);
    expect(status).toBe(200);
    expect(body.some((row) => row.email === ADMIN.email)).toBe(true);
  });

  it("requires auth", async () => {
    expect((await app.inject({ method: "GET", url: "/users" })).statusCode).toBe(401);
  });
});

describe("POST /users", () => {
  const NEW_USER = { email: "Mom@Example.COM", password: "mom-secret", role: "user" as const };

  it("creates a user (normalized email) who can then log in", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/users",
      headers: bearer(adminToken),
      payload: { ...NEW_USER, email: ` ${NEW_USER.email} ` },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as UserDto;
    expect(Object.keys(body).sort()).toEqual(["createdAt", "email", "id", "role"]);
    expect(body.email).toBe("mom@example.com");
    expect(body.role).toBe("user");

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "mom@example.com", password: NEW_USER.password },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().user.email).toBe("mom@example.com");
  });

  it("persists only the bcrypt hash — never the plaintext password", async () => {
    const rows = db.select().from(users).all();
    for (const row of rows) {
      expect(JSON.stringify(row)).not.toContain("mom-secret");
    }
    const stored = db.select().from(users).where(eq(users.email, "mom@example.com")).get();
    expect(stored?.passwordHash.startsWith("$2")).toBe(true);
    expect(compareSync(NEW_USER.password, stored?.passwordHash ?? "")).toBe(true);
  });

  it("409s for duplicate emails, case-insensitively", async () => {
    for (const email of ["mom@example.com", "MOM@EXAMPLE.COM"]) {
      const res = await app.inject({
        method: "POST",
        url: "/users",
        headers: bearer(adminToken),
        payload: { ...NEW_USER, email },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("CONFLICT");
    }
  });

  it("validates email, password, and role", async () => {
    const cases = [
      { email: "nope", password: "x", role: "user" },
      { email: "a@b.co", password: "", role: "user" },
      { email: "a@b.co", password: "x", role: "superuser" },
      { email: "a@b.co", password: "x" },
      { password: "x", role: "user" },
    ];
    for (const payload of cases) {
      const res = await app.inject({
        method: "POST",
        url: "/users",
        headers: bearer(adminToken),
        payload,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("can create another admin, who passes the admin gate", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/users",
      headers: bearer(adminToken),
      payload: { email: "second-admin@example.com", password: "second-secret", role: "admin" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().role).toBe("admin");
    const { status, body } = await listOfUsers(
      await accessTokenOf("second-admin@example.com", "second-secret"),
    );
    expect(status).toBe(200);
    expect(body.some((row) => row.email === "second-admin@example.com")).toBe(true);
  });

  it("403s for non-admins and 401s without auth", async () => {
    const denied = await app.inject({
      method: "POST",
      url: "/users",
      headers: bearer(plainToken),
      payload: { email: "denied@example.com", password: "x", role: "user" },
    });
    expect(denied.statusCode).toBe(403);
    const unauth = await app.inject({
      method: "POST",
      url: "/users",
      payload: { email: "denied@example.com", password: "x", role: "user" },
    });
    expect(unauth.statusCode).toBe(401);
  });
});

describe("DELETE /users/:id", () => {
  it("409s when the user owns lists, leaving the user and list intact", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/users/${plainId}`,
      headers: bearer(adminToken),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CONFLICT");
    // The user (and their list) still exists.
    const { body } = await listOfUsers(adminToken);
    expect(body.some((row) => row.id === plainId)).toBe(true);
    expect(
      (await app.inject({ method: "GET", url: "/lists", headers: bearer(plainToken) })).statusCode,
    ).toBe(200);
  });

  it("deletes a list-less user → 204, revokes sessions, cascades their API tokens", async () => {
    // A disposable user without lists, plus an API token that must cascade away.
    const created = await app.inject({
      method: "POST",
      url: "/users",
      headers: bearer(adminToken),
      payload: { email: "disposable@example.com", password: "disposable-secret", role: "user" },
    });
    expect(created.statusCode).toBe(201);
    const disposableId = created.json().id as string;
    const tokenRes = await app.inject({
      method: "POST",
      url: "/api-tokens",
      headers: bearer(await accessTokenOf("disposable@example.com", "disposable-secret")),
      payload: { name: "doomed-agent" },
    });
    expect(tokenRes.statusCode).toBe(201);

    const res = await app.inject({
      method: "DELETE",
      url: `/users/${disposableId}`,
      headers: bearer(adminToken),
    });
    expect(res.statusCode).toBe(204);
    expect(db.select().from(users).where(eq(users.id, disposableId)).all()).toHaveLength(0);

    // Their access token no longer resolves: login fails…
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "disposable@example.com", password: "disposable-secret" },
    });
    expect(login.statusCode).toBe(401);
    // …and the cascaded-away API token no longer authorizes.
    const viaToken = await app.inject({
      method: "GET",
      url: "/lists",
      headers: bearer(tokenRes.json().token as string),
    });
    expect(viaToken.statusCode).toBe(401);
  });

  it("404s for unknown ids", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/users/does-not-exist",
      headers: bearer(adminToken),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("403s for non-admins and 401s without auth", async () => {
    const denied = await app.inject({
      method: "DELETE",
      url: `/users/${plainId}`,
      headers: bearer(outsiderToken),
    });
    expect(denied.statusCode).toBe(403);
    const unauth = await app.inject({ method: "DELETE", url: `/users/${plainId}` });
    expect(unauth.statusCode).toBe(401);
  });
});
