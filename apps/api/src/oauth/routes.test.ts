import { YANDEX_BROKER_REDIRECT, oauthTokenResponseSchema } from "@grocery/shared";
import { createId } from "@paralleldrive/cuid2";
import { hashSync } from "bcryptjs";
import type { FastifyInstance } from "fastify";
import { beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { loadConfig } from "../config";
import { type Db, createDb, createSqlite } from "../db/client";
import { runMigrations } from "../db/migrate";
import { users } from "../db/schema";
import { validateAccessToken } from "./oauthService";

/** Dev-only placeholder whose sha256 is seeded by the 0002 migration. */
const CLIENT_ID = "alice";
const CLIENT_SECRET = "alice-dev-secret-change-me";

const USER = { email: "oauth-user@example.com", password: "link-password-123" };

let app: FastifyInstance;
let db: Db;

function authorizeUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: YANDEX_BROKER_REDIRECT,
    scope: "alice",
    state,
  });
  return `/oauth/authorize?${params.toString()}`;
}

function formPayload(values: Record<string, string>): {
  payload: string;
  headers: Record<string, string>;
} {
  return {
    payload: new URLSearchParams(values).toString(),
    headers: { "content-type": "application/x-www-form-urlencoded" },
  };
}

function postAuthorize(
  values: Record<string, string>,
): Promise<{ status: number; location: string | undefined }> {
  const { payload, headers } = formPayload(values);
  return app.inject({ method: "POST", url: "/oauth/authorize", headers, payload }).then((res) => ({
    status: res.statusCode,
    location: res.headers.location as string | undefined,
  }));
}

function postToken(
  values: Record<string, string>,
): Promise<{ statusCode: number; json: () => unknown }> {
  const { payload, headers } = formPayload(values);
  return app.inject({ method: "POST", url: "/oauth/token", headers, payload });
}

function codeFromLocation(location: string): { code: string; state: string | null } {
  const target = new URL(location);
  const code = target.searchParams.get("code");
  if (!code) throw new Error(`no code in redirect ${location}`);
  return { code, state: target.searchParams.get("state") };
}

beforeAll(async () => {
  const sqlite = createSqlite(":memory:");
  db = createDb(sqlite);
  runMigrations(db);
  app = buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent" }), { db });
  await app.ready();
  db.insert(users)
    .values({
      id: createId(),
      email: USER.email,
      passwordHash: hashSync(USER.password, 10),
      role: "user",
    })
    .run();
});

describe("GET /oauth/authorize", () => {
  it("renders the email-login + consent form as API-served HTML", async () => {
    const res = await app.inject({ method: "GET", url: authorizeUrl("s1") });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain('name="email"');
    expect(res.body).toContain('name="password"');
    expect(res.body).toContain(`value="${CLIENT_ID}"`);
  });

  it("rejects an unknown client_id with 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/oauth/authorize?response_type=code&client_id=nope&redirect_uri=${encodeURIComponent(YANDEX_BROKER_REDIRECT)}`,
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a foreign redirect_uri with 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/oauth/authorize?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent("https://evil.example/cb")}`,
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("OAuth link flow (login → code → tokens → refresh rotation)", () => {
  it("walks the full Yandex linking flow within Yandex's limits", async () => {
    const state = "yandex-state-42";

    const authorized = await postAuthorize({
      email: USER.email,
      password: USER.password,
      client_id: CLIENT_ID,
      redirect_uri: YANDEX_BROKER_REDIRECT,
      scope: "alice",
      state,
    });
    expect(authorized.status).toBe(302);
    expect(authorized.location?.startsWith(`${YANDEX_BROKER_REDIRECT}?`)).toBe(true);
    const { code, state: echoed } = codeFromLocation(authorized.location as string);
    expect(echoed).toBe(state);

    const tokenRes = await postToken({
      grant_type: "authorization_code",
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    });
    expect(tokenRes.statusCode).toBe(200);
    const tokens = oauthTokenResponseSchema.parse(tokenRes.json());
    expect(Number.isInteger(tokens.expires_in)).toBe(true);
    expect(tokens.access_token.length).toBeLessThanOrEqual(2048);
    expect(tokens.refresh_token.length).toBeLessThanOrEqual(2048);
    expect(JSON.stringify(tokenRes.json()).length).toBeLessThanOrEqual(5000);

    const rotatedRes = await postToken({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    });
    expect(rotatedRes.statusCode).toBe(200);
    const rotated = oauthTokenResponseSchema.parse(rotatedRes.json());
    expect(rotated.access_token).not.toBe(tokens.access_token);
    expect(rotated.refresh_token).not.toBe(tokens.refresh_token);

    // Rotation revokes the old pair: old access dead, new access live.
    expect(validateAccessToken(db, tokens.access_token)).toBeNull();
    expect(validateAccessToken(db, rotated.access_token)?.clientId).toBe(CLIENT_ID);

    // Replaying the old refresh token fails.
    const replay = await postToken({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    });
    expect(replay.statusCode).toBe(400);
  });

  it("echoes a tricky state value verbatim", async () => {
    const state = "st ate/x?y=2&z=3+%==";
    const authorized = await postAuthorize({
      email: USER.email,
      password: USER.password,
      client_id: CLIENT_ID,
      redirect_uri: YANDEX_BROKER_REDIRECT,
      state,
    });
    expect(authorized.status).toBe(302);
    expect(codeFromLocation(authorized.location as string).state).toBe(state);
  });

  it("issues no code on a wrong password (401)", async () => {
    const authorized = await postAuthorize({
      email: USER.email,
      password: "wrong-password",
      client_id: CLIENT_ID,
      redirect_uri: YANDEX_BROKER_REDIRECT,
      state: "s2",
    });
    expect(authorized.status).toBe(401);
    expect(authorized.location).toBeUndefined();
  });

  it("rejects a bad client secret with 401", async () => {
    const authorized = await postAuthorize({
      email: USER.email,
      password: USER.password,
      client_id: CLIENT_ID,
      redirect_uri: YANDEX_BROKER_REDIRECT,
      state: "s3",
    });
    const { code } = codeFromLocation(authorized.location as string);
    const tokenRes = await postToken({
      grant_type: "authorization_code",
      code,
      client_id: CLIENT_ID,
      client_secret: "wrong-secret",
    });
    expect(tokenRes.statusCode).toBe(401);
  });

  it("rejects a replayed authorization code with 400", async () => {
    const authorized = await postAuthorize({
      email: USER.email,
      password: USER.password,
      client_id: CLIENT_ID,
      redirect_uri: YANDEX_BROKER_REDIRECT,
      state: "s4",
    });
    const { code } = codeFromLocation(authorized.location as string);
    const first = await postToken({
      grant_type: "authorization_code",
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    });
    expect(first.statusCode).toBe(200);
    const second = await postToken({
      grant_type: "authorization_code",
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    });
    expect(second.statusCode).toBe(400);
  });
});
