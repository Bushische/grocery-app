import { REFRESH_COOKIE_NAME } from "@grocery/shared";
import { createId } from "@paralleldrive/cuid2";
import { hashSync } from "bcryptjs";
import type { FastifyInstance } from "fastify";
import { beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { loadConfig } from "../config";
import { type Db, createDb, createSqlite } from "../db/client";
import { runMigrations } from "../db/migrate";
import { telegramLinks, users } from "../db/schema";
import { signTelegramCheckString } from "./initData";

/** Fixture bot token injected via loadConfig — never a real secret. */
const BOT_TOKEN = "fixture-telegram-bot-token";

const USER_A = { email: "tg-a@example.com", password: "password-a-1" };
const USER_B = { email: "tg-b@example.com", password: "password-b-2" };
const TELEGRAM_ID = "279058397";

let app: FastifyInstance;
let db: Db;

function buildInitData(params: Record<string, string>, botToken: string): string {
  const checkString = Object.entries(params)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const hash = signTelegramCheckString(checkString, botToken);
  return new URLSearchParams({ ...params, hash }).toString();
}

function freshInitData(telegramId: string | number, botToken: string = BOT_TOKEN): string {
  return buildInitData(
    {
      auth_date: String(Math.floor(Date.now() / 1000) - 60),
      query_id: "AAHdF6IQAAAAAN0XohDhrOrc",
      user: JSON.stringify({ id: telegramId, first_name: "Test" }),
    },
    botToken,
  );
}

function setCookies(res: Awaited<ReturnType<FastifyInstance["inject"]>>): string[] {
  const raw = res.headers["set-cookie"];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function hasRefreshCookie(res: Awaited<ReturnType<FastifyInstance["inject"]>>): boolean {
  return setCookies(res).some((cookie) => cookie.startsWith(`${REFRESH_COOKIE_NAME}=`));
}

function linkCount(): number {
  return db.select().from(telegramLinks).all().length;
}

beforeAll(() => {
  const sqlite = createSqlite(":memory:");
  db = createDb(sqlite);
  runMigrations(db);
  for (const user of [USER_A, USER_B]) {
    db.insert(users)
      .values({
        id: createId(),
        email: user.email,
        passwordHash: hashSync(user.password, 10),
        role: "user",
      })
      .run();
  }
  app = buildApp(
    loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", TELEGRAM_BOT_TOKEN: BOT_TOKEN }),
    { db },
  );
});

describe("POST /auth/telegram/session (passwordless login)", () => {
  it("returns 404 with no cookie when the Telegram account is not linked", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/telegram/session",
      payload: { initData: freshInitData("unlinked-id-1") },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: { code: "NOT_FOUND", message: "Telegram account not linked" },
    });
    expect(hasRefreshCookie(res)).toBe(false);
  });

  it("rejects tampered initData with 401", async () => {
    const tampered = new URLSearchParams(freshInitData(TELEGRAM_ID));
    tampered.set("user", JSON.stringify({ id: 999 }));
    const res = await app.inject({
      method: "POST",
      url: "/auth/telegram/session",
      payload: { initData: tampered.toString() },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects initData signed with another bot token with 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/telegram/session",
      payload: { initData: freshInitData(TELEGRAM_ID, "wrong-token") },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /auth/telegram/link (one-time email+password binding)", () => {
  it("rejects a wrong password with 401 and creates no link", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/telegram/link",
      payload: {
        email: USER_A.email,
        password: "wrong-password",
        initData: freshInitData("no-link-row"),
      },
    });
    expect(res.statusCode).toBe(401);
    expect(linkCount()).toBe(0);
  });

  it("links on correct credentials and issues the standard session", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/telegram/link",
      payload: {
        email: USER_A.email,
        password: USER_A.password,
        initData: freshInitData(TELEGRAM_ID),
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(["accessToken", "user"]);
    expect(body.user.email).toBe(USER_A.email);
    expect(hasRefreshCookie(res)).toBe(true);
    expect(linkCount()).toBe(1);
  });

  it("session hits after linking — no password needed", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/telegram/session",
      payload: { initData: freshInitData(TELEGRAM_ID) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe(USER_A.email);
    expect(hasRefreshCookie(res)).toBe(true);
  });

  it("re-linking the same Telegram id to another user MOVES the link (Q3)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/telegram/link",
      payload: {
        email: USER_B.email,
        password: USER_B.password,
        initData: freshInitData(TELEGRAM_ID),
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe(USER_B.email);
    expect(linkCount()).toBe(1);
    // The previous user is simply unlinked again.
    const retry = await app.inject({
      method: "POST",
      url: "/auth/telegram/session",
      payload: { initData: freshInitData(TELEGRAM_ID) },
    });
    expect(retry.json().user.email).toBe(USER_B.email);
  });
});

describe("DELETE /auth/telegram/link (unlink)", () => {
  it("requires auth", async () => {
    const res = await app.inject({ method: "DELETE", url: "/auth/telegram/link" });
    expect(res.statusCode).toBe(401);
  });

  it("unlinks the caller; the next session misses with 404", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: USER_B.email, password: USER_B.password },
    });
    const accessToken = (login.json() as { accessToken: string }).accessToken;
    const res = await app.inject({
      method: "DELETE",
      url: "/auth/telegram/link",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(204);
    expect(linkCount()).toBe(0);
    const retry = await app.inject({
      method: "POST",
      url: "/auth/telegram/session",
      payload: { initData: freshInitData(TELEGRAM_ID) },
    });
    expect(retry.statusCode).toBe(404);
  });
});
