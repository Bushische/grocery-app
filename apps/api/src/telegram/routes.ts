import {
  REFRESH_COOKIE_NAME,
  loginResponseSchema,
  telegramLinkRequestSchema,
  telegramSessionRequestSchema,
} from "@grocery/shared";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { users } from "../db/schema";
import { FastifyHttpError } from "../errors";
import { requireAuth, signAccessToken } from "../plugins/auth";
import { REFRESH_COOKIE_OPTIONS } from "../routes/auth";
import { authenticate, issueRefreshToken } from "../services/authService";
import { validateTelegramInitData } from "./initData";
import { getTelegramLinkByTelegramId, linkTelegramAccount, unlinkTelegramAccount } from "./service";

export type TelegramRoutesOptions = { botToken: string; maxAgeSeconds: number };

/**
 * Telegram Mini App auth (docs/TELEGRAM_PLAN.md → §2): passwordless session
 * for linked devices, one-time email+password link for new ones. Both success
 * paths issue the STANDARD session — 15-min JWT in the body + the same
 * 30-day refresh cookie as `POST /auth/login` (shared `REFRESH_COOKIE_OPTIONS`,
 * same rotation semantics) — so every existing guard applies unchanged.
 */
export async function telegramRoutes(
  app: FastifyInstance,
  options: TelegramRoutesOptions,
): Promise<void> {
  const db = app.db;
  const { botToken, maxAgeSeconds } = options;

  app.post("/auth/telegram/session", async (request, reply) => {
    const body = telegramSessionRequestSchema.parse(request.body);
    const { telegramId } = validateTelegramInitData(body.initData, botToken, { maxAgeSeconds });
    const link = getTelegramLinkByTelegramId(db, telegramId);
    if (!link) {
      // Unlinked (or moved-away) device: the client shows the one-time link form.
      throw new FastifyHttpError(404, "NOT_FOUND", "Telegram account not linked");
    }
    const user = db.select().from(users).where(eq(users.id, link.userId)).get();
    if (!user) {
      throw new FastifyHttpError(404, "NOT_FOUND", "Telegram account not linked");
    }
    const refreshToken = issueRefreshToken(db, user.id);
    reply.setCookie(REFRESH_COOKIE_NAME, refreshToken.token, REFRESH_COOKIE_OPTIONS);
    return loginResponseSchema.parse({
      accessToken: signAccessToken(app, user),
      user: { id: user.id, email: user.email, role: user.role },
    });
  });

  app.post("/auth/telegram/link", async (request, reply) => {
    const body = telegramLinkRequestSchema.parse(request.body);
    const { telegramId } = validateTelegramInitData(body.initData, botToken, { maxAgeSeconds });
    // Same timing-equalized 401 as /auth/login — emails stay non-enumerable.
    const user = await authenticate(db, body.email, body.password);
    // Re-assigns by default when this Telegram id belongs to another user (Q3).
    linkTelegramAccount(db, user.id, telegramId);
    const refreshToken = issueRefreshToken(db, user.id);
    reply.setCookie(REFRESH_COOKIE_NAME, refreshToken.token, REFRESH_COOKIE_OPTIONS);
    return loginResponseSchema.parse({
      accessToken: signAccessToken(app, user),
      user: { id: user.id, email: user.email, role: user.role },
    });
  });

  app.delete("/auth/telegram/link", { preHandler: requireAuth }, async (request, reply) => {
    unlinkTelegramAccount(db, request.user.id);
    return reply.status(204).send();
  });
}
