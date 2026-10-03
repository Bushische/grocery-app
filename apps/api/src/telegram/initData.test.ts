import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FastifyHttpError } from "../errors";
import {
  buildTelegramCheckString,
  signTelegramCheckString,
  validateTelegramInitData,
} from "./initData";

const BOT_TOKEN = "fixture-bot-token-12345";
const WRONG_TOKEN = "another-bot-token-67890";

function buildInitData(params: Record<string, string>, botToken: string): string {
  const checkString = Object.entries(params)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const hash = signTelegramCheckString(checkString, botToken);
  return new URLSearchParams({ ...params, hash }).toString();
}

function baseParams(authDateSeconds: number, userId = 279058397): Record<string, string> {
  return {
    auth_date: String(authDateSeconds),
    query_id: "AAHdF6IQAAAAAN0XohDhrOrc",
    user: JSON.stringify({ id: userId, first_name: "Vlad", username: "vdkfrost" }),
  };
}

function expectUnauthorized(fn: () => unknown): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(FastifyHttpError);
    expect((error as FastifyHttpError).status).toBe(401);
    expect((error as FastifyHttpError).code).toBe("UNAUTHORIZED");
    return;
  }
  throw new Error("expected FastifyHttpError 401 UNAUTHORIZED");
}

describe("validateTelegramInitData (docs/TELEGRAM_PLAN.md → §1)", () => {
  it("accepts data signed with the bot token and returns the Telegram user id", () => {
    const nowMs = 1_737_000_000_000;
    const initData = buildInitData(baseParams(Math.floor(nowMs / 1000) - 60), BOT_TOKEN);
    const result = validateTelegramInitData(initData, BOT_TOKEN, { nowMs });
    expect(result.telegramId).toBe("279058397");
    expect(result.authDate.getTime()).toBe((Math.floor(nowMs / 1000) - 60) * 1000);
  });

  it("matches the documented HMAC(WebAppData) algorithm byte-for-byte", () => {
    const secret = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
    const direct = createHmac("sha256", secret).update("auth_date=1").digest("hex");
    expect(signTelegramCheckString("auth_date=1", BOT_TOKEN)).toBe(direct);
    const { checkString } = buildTelegramCheckString(
      buildInitData({ auth_date: "1", user: '{"id":7}' }, BOT_TOKEN),
    );
    expect(checkString).toBe('auth_date=1\nuser={"id":7}');
  });

  it("rejects a tampered user id that reuses the original hash", () => {
    const nowMs = 1_737_000_000_000;
    const original = buildInitData(baseParams(Math.floor(nowMs / 1000) - 60, 111), BOT_TOKEN);
    const params = new URLSearchParams(original);
    params.set("user", JSON.stringify({ id: 999, first_name: "Mallory" }));
    expectUnauthorized(() => validateTelegramInitData(params.toString(), BOT_TOKEN, { nowMs }));
  });

  it("rejects data signed with a different bot token", () => {
    const nowMs = 1_737_000_000_000;
    const initData = buildInitData(baseParams(Math.floor(nowMs / 1000) - 60), WRONG_TOKEN);
    expectUnauthorized(() => validateTelegramInitData(initData, BOT_TOKEN, { nowMs }));
  });

  it("rejects stale initData past the 24 h freshness window (replay protection)", () => {
    const authDate = 1_700_000_000;
    const initData = buildInitData(baseParams(authDate), BOT_TOKEN);
    // 25 h later — passes the HMAC, fails the freshness window.
    expectUnauthorized(() =>
      validateTelegramInitData(initData, BOT_TOKEN, { nowMs: (authDate + 25 * 3600) * 1000 }),
    );
  });

  it("rejects unsigned, user-less, and malformed initData", () => {
    const nowMs = 1_737_000_000_000;
    expectUnauthorized(() => validateTelegramInitData('auth_date=1&user={"id":1}', BOT_TOKEN));
    const noUser = buildInitData({ auth_date: String(Math.floor(nowMs / 1000)) }, BOT_TOKEN);
    expectUnauthorized(() => validateTelegramInitData(noUser, BOT_TOKEN, { nowMs }));
    expectUnauthorized(() => validateTelegramInitData("", BOT_TOKEN));
  });
});
