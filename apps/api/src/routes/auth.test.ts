import { createHash } from "node:crypto";
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH, REFRESH_TTL_SECONDS } from "@grocery/shared";
import { createId } from "@paralleldrive/cuid2";
import { hashSync } from "bcryptjs";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { loadConfig } from "../config";
import { type Db, createDb, createSqlite } from "../db/client";
import { runMigrations } from "../db/migrate";
import { refreshTokens, users } from "../db/schema";

const ADMIN = {
  email: "alex@example.com",
  password: "correct-horse-battery",
  role: "admin" as const,
};
const MEMBER = { email: "sam@example.com", password: "member-password", role: "user" as const };

type InjectResponse = Awaited<ReturnType<FastifyInstance["inject"]>>;

let app: FastifyInstance;
let db: Db;

function buildTestApp(): { app: FastifyInstance; db: Db } {
  const sqlite = createSqlite(":memory:");
  const db = createDb(sqlite);
  runMigrations(db);
  const app = buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent" }), { db });
  return { app, db };
}

function setCookies(res: InjectResponse): string[] {
  const raw = res.headers["set-cookie"];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function refreshCookie(res: InjectResponse): string {
  const cookie = setCookies(res).find((candidate) =>
    candidate.startsWith(`${REFRESH_COOKIE_NAME}=`),
  );
  if (!cookie) throw new Error(`no ${REFRESH_COOKIE_NAME} cookie in response`);
  return cookie;
}

function refreshCookieValue(res: InjectResponse): string {
  const cookie = refreshCookie(res);
  return cookie.slice(`${REFRESH_COOKIE_NAME}=`.length, cookie.indexOf(";"));
}

function login(email: string, password: string): Promise<InjectResponse> {
  return app.inject({ method: "POST", url: "/auth/login", payload: { email, password } });
}

function refreshWith(cookieValue: string): Promise<InjectResponse> {
  return app.inject({
    method: "POST",
    url: "/auth/refresh",
    headers: { cookie: `${REFRESH_COOKIE_NAME}=${cookieValue}` },
  });
}

function refreshTokenCount(): number {
  return db.select().from(refreshTokens).all().length;
}

beforeAll(() => {
  ({ app, db } = buildTestApp());
  db.insert(users)
    .values([
      {
        id: createId(),
        email: ADMIN.email,
        passwordHash: hashSync(ADMIN.password, 10),
        role: ADMIN.role,
      },
      {
        id: createId(),
        email: MEMBER.email,
        passwordHash: hashSync(MEMBER.password, 10),
        role: MEMBER.role,
      },
    ])
    .run();
});

describe("POST /auth/login", () => {
  it("returns an access token and the user per docs/API.md", async () => {
    const res = await login(ADMIN.email, ADMIN.password);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(["accessToken", "user"]);
    expect(body.user).toEqual({ id: expect.any(String), email: ADMIN.email, role: "admin" });
    const claims = app.jwt.decode(body.accessToken) as { sub: string; email: string; role: string };
    expect(claims.sub).toBe(body.user.id);
    expect(claims.email).toBe(ADMIN.email);
    expect(claims.role).toBe("admin");
  });

  it("sets the refresh cookie verbatim (HttpOnly, Secure, SameSite=Strict, Path=/api/auth, Max-Age=2592000)", async () => {
    const res = await login(ADMIN.email, ADMIN.password);
    const cookie = refreshCookie(res);
    expect(cookie).toMatch(/^refresh_token=[A-Za-z0-9_-]+;/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain(`Path=${REFRESH_COOKIE_PATH}`);
    expect(cookie).toContain(`Max-Age=${REFRESH_TTL_SECONDS}`);
  });

  it("stores only the sha256 hash of the refresh token", async () => {
    const presented = refreshCookieValue(await login(ADMIN.email, ADMIN.password));
    const tokenHash = createHash("sha256").update(presented).digest("hex");
    const stored = db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .get();
    expect(stored).toBeDefined();
    expect(stored?.tokenHash).not.toBe(presented);
    expect(
      db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, presented)).get(),
    ).toBeUndefined();
  });

  it("rejects a wrong password with 401", async () => {
    const res = await login(ADMIN.email, "wrong-password");
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });

  it("rejects an unknown email with 401", async () => {
    const res = await login("nobody@example.com", ADMIN.password);
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });

  it("validates the request body", async () => {
    const bad = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "not-an-email", password: "x" },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe("VALIDATION_ERROR");

    const empty = await app.inject({ method: "POST", url: "/auth/login", payload: {} });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().error.code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /me", () => {
  it("returns the authenticated user from a bearer token", async () => {
    const loginRes = await login(MEMBER.email, MEMBER.password);
    const res = await app.inject({
      method: "GET",
      url: "/me",
      headers: { authorization: `Bearer ${loginRes.json().accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(loginRes.json().user);
  });

  it("rejects missing, malformed, and expired tokens with 401", async () => {
    const missing = await app.inject({ method: "GET", url: "/me" });
    expect(missing.statusCode).toBe(401);
    expect(missing.json().error.code).toBe("UNAUTHORIZED");

    const garbage = await app.inject({
      method: "GET",
      url: "/me",
      headers: { authorization: "Bearer not-a-jwt" },
    });
    expect(garbage.statusCode).toBe(401);

    const expired = app.jwt.sign(
      { sub: createId(), email: MEMBER.email, role: MEMBER.role },
      { expiresIn: -1000 },
    );
    const res = await app.inject({
      method: "GET",
      url: "/me",
      headers: { authorization: `Bearer ${expired}` },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /auth/refresh", () => {
  it("returns a new access token and rotates the cookie (old refresh rejected)", async () => {
    const loginRes = await login(ADMIN.email, ADMIN.password);
    const oldToken = refreshCookieValue(loginRes);
    const before = refreshTokenCount();

    const rotated = await refreshWith(oldToken);
    expect(rotated.statusCode).toBe(200);
    const body = rotated.json();
    expect(Object.keys(body).sort()).toEqual(["accessToken", "user"]);
    // Same-second signatures are byte-identical, so prove freshness by use:
    // the returned token must authenticate /me as the same user.
    const me = await app.inject({
      method: "GET",
      url: "/me",
      headers: { authorization: `Bearer ${body.accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual(body.user);
    const newToken = refreshCookieValue(rotated);
    expect(newToken).not.toBe(oldToken);
    expect(refreshTokenCount()).toBe(before);

    const replayed = await refreshWith(oldToken);
    expect(replayed.statusCode).toBe(401);
    expect(replayed.json().error.code).toBe("UNAUTHORIZED");
    const again = await refreshWith(newToken);
    expect(again.statusCode).toBe(200);
  });

  it("rejects a missing or unknown refresh token with 401", async () => {
    const missing = await app.inject({ method: "POST", url: "/auth/refresh" });
    expect(missing.statusCode).toBe(401);
    expect(missing.json().error.code).toBe("UNAUTHORIZED");

    const bogus = await refreshWith("never-issued-token");
    expect(bogus.statusCode).toBe(401);
    expect(bogus.json().error.code).toBe("UNAUTHORIZED");
  });
});

describe("POST /auth/logout", () => {
  it("revokes the refresh token and clears the cookie", async () => {
    const presented = refreshCookieValue(await login(ADMIN.email, ADMIN.password));
    const before = refreshTokenCount();

    const res = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { cookie: `${REFRESH_COOKIE_NAME}=${presented}` },
    });
    expect(res.statusCode).toBe(204);
    const cleared = setCookies(res).find((candidate) =>
      candidate.startsWith(`${REFRESH_COOKIE_NAME}=`),
    );
    expect(cleared).toBeDefined();
    expect(cleared).toMatch(/^refresh_token=;/);
    expect(refreshTokenCount()).toBe(before - 1);

    const revoked = await refreshWith(presented);
    expect(revoked.statusCode).toBe(401);
  });

  it("responds 204 without a cookie (idempotent)", async () => {
    const res = await app.inject({ method: "POST", url: "/auth/logout" });
    expect(res.statusCode).toBe(204);
  });
});
