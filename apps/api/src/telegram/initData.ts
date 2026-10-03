import { createHmac, timingSafeEqual } from "node:crypto";
import { TELEGRAM_AUTH_MAX_AGE_SECONDS } from "@grocery/shared";
import { FastifyHttpError } from "../errors";

export type ValidatedTelegramInitData = { telegramId: string; authDate: Date };

const unauthorized = (message: string) => new FastifyHttpError(401, "UNAUTHORIZED", message);

/**
 * Builds the `data-check-string` from Telegram Mini App `initData`
 * (docs/TELEGRAM_PLAN.md → §1): all query pairs except `hash`, sorted
 * alphabetically, joined as `key=value` lines with `\n`. `URLSearchParams`
 * decodes percent-encoding, matching how Telegram computes the signature.
 */
export function buildTelegramCheckString(initData: string): { checkString: string; hash: string } {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    throw unauthorized("Malformed Telegram initData");
  }
  const hash = params.get("hash") ?? "";
  if (hash === "") {
    throw unauthorized("Telegram initData is not signed");
  }
  params.delete("hash");
  const checkString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  return { checkString, hash };
}

/**
 * Computes the expected hex signature for a check string with the bot token
 * (`secret = HMAC_SHA256(key="WebAppData", msg=botToken)`, then
 * `hex(HMAC_SHA256(key=secret, msg=checkString))`). Exported so tests build
 * fixture vectors with the same algorithm Telegram uses.
 */
export function signTelegramCheckString(checkString: string, botToken: string): string {
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  return createHmac("sha256", secret).update(checkString).digest("hex");
}

/**
 * Validates Telegram Mini App `initData` (docs/TELEGRAM_PLAN.md → §1):
 * HMAC signature check (constant-time) + `auth_date` freshness window.
 * Returns the verified Telegram user id (stored as TEXT) — the ONLY identity
 * the API accepts; `initDataUnsafe` on the client must never drive auth.
 * Throws 401 UNAUTHORIZED on missing/tampered signatures, stale or malformed data.
 */
export function validateTelegramInitData(
  initData: string,
  botToken: string,
  options: { maxAgeSeconds?: number; nowMs?: number } = {},
): ValidatedTelegramInitData {
  if (!botToken) {
    throw new FastifyHttpError(500, "INTERNAL_ERROR", "Telegram bot token is not configured");
  }
  const maxAgeSeconds = options.maxAgeSeconds ?? TELEGRAM_AUTH_MAX_AGE_SECONDS;
  const nowMs = options.nowMs ?? Date.now();
  const { checkString, hash } = buildTelegramCheckString(initData);
  const expectedHex = signTelegramCheckString(checkString, botToken);
  const given = Buffer.from(hash, "hex");
  const expected = Buffer.from(expectedHex, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw unauthorized("Invalid Telegram initData signature");
  }
  const params = new URLSearchParams(initData);
  const authDateRaw = params.get("auth_date") ?? "";
  const authDateSeconds = Number(authDateRaw);
  if (!Number.isFinite(authDateSeconds) || authDateSeconds <= 0) {
    throw unauthorized("Telegram initData has no valid auth_date");
  }
  if (nowMs / 1000 - authDateSeconds > maxAgeSeconds) {
    throw unauthorized("Telegram initData is stale");
  }
  let telegramId: string;
  try {
    const user = JSON.parse(params.get("user") ?? "") as { id?: unknown };
    if (typeof user.id === "number" && Number.isFinite(user.id)) {
      telegramId = String(Math.trunc(user.id));
    } else if (typeof user.id === "string" && user.id.trim() !== "") {
      telegramId = user.id.trim();
    } else {
      throw new Error("missing user.id");
    }
  } catch {
    throw unauthorized("Telegram initData has no valid user");
  }
  return { telegramId, authDate: new Date(authDateSeconds * 1000) };
}
