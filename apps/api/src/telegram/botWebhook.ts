import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { FastifyHttpError } from "../errors";
import { type BotSender, createBotSender } from "./botApi";
import { handleTelegramChat } from "./botDialog";
import type { ActionExtractor } from "./extract";
import { type TelegramChatType, telegramUpdateSchema } from "./protocol";
import { getTelegramLinkByTelegramId } from "./service";

export type BotWebhookOptions = {
  botToken: string;
  webhookSecret: string;
  miniAppUrl: string;
  /** Test seam — defaults to the real HTTPS sender. */
  sender?: BotSender;
  /** T66 extractor (JEV when configured); absent = deterministic only. */
  extractor?: ActionExtractor;
  confidenceThreshold?: number;
};

export const BOT_LINK_PROMPT_TEXT =
  "Привяжите Telegram, чтобы команды из чата работали: откройте приложение " +
  "и войдите один раз — дальше пароль не понадобится.\n" +
  "Link Telegram so chat commands work: open the app and sign in once.";

function secretsEqual(configured: string, presented: string | string[] | undefined): boolean {
  if (typeof presented !== "string") return false;
  const expected = Buffer.from(configured);
  const given = Buffer.from(presented);
  if (expected.length === 0 || given.length !== expected.length) return false;
  return timingSafeEqual(expected, given);
}

export type ExtractedCommand = { text: string; addressed: boolean };

/**
 * Extracts the candidate command from a message: strips a leading @mention
 * and a leading /command (`/start`, `/buy@bot milk`). `addressed` tells
 * whether the sender explicitly addressed the bot — group chatter without it
 * stays silent (never spam a group).
 */
export function extractCommandText(rawText: string): ExtractedCommand {
  let text = rawText.trim();
  let addressed = false;
  const mention = text.match(/^@[\w_]{3,}\s+/u);
  if (mention) {
    text = text.slice(mention[0].length).trim();
    addressed = true;
  }
  const slash = text.match(/^\/[\w_]+(?:@[\w_]+)?\s*/u);
  if (slash) {
    text = text.slice(slash[0].length).trim();
    addressed = true;
  }
  return { text, addressed };
}

/**
 * Telegram Bot API webhook (docs/TELEGRAM_PLAN.md → §7): secret-token check
 * (fail-closed 401), silent ack for everything unprocessable, link gating,
 * help for linked users. T63 routes linked users to grocery intents.
 */
export async function botWebhookRoutes(
  app: FastifyInstance,
  options: BotWebhookOptions,
): Promise<void> {
  const db = app.db;
  const { botToken, webhookSecret, miniAppUrl } = options;
  const sender = options.sender ?? createBotSender(botToken);

  app.post("/telegram/bot-webhook", async (request, reply) => {
    if (!secretsEqual(webhookSecret, request.headers["x-telegram-bot-api-secret-token"])) {
      throw new FastifyHttpError(401, "UNAUTHORIZED", "Invalid webhook secret");
    }
    const parsed = telegramUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.send({ ok: true });
    }
    const message = parsed.data.message;
    if (!message?.text || message.from?.is_bot === true) {
      return reply.send({ ok: true });
    }
    const senderId = message.from?.id;
    if (senderId === undefined) {
      return reply.send({ ok: true });
    }
    const chatId = message.chat.id;
    const chatType: TelegramChatType = message.chat.type;
    const { text, addressed } = extractCommandText(message.text);
    if (chatType !== "private" && !addressed) {
      return reply.send({ ok: true });
    }

    const link = getTelegramLinkByTelegramId(db, String(senderId));
    if (!link) {
      await sendQuietly(request, sender, chatId, BOT_LINK_PROMPT_TEXT, miniAppUrl);
      return reply.send({ ok: true });
    }
    // Product source (T65): the command text wins (it may carry a list
    // suffix like `/buy in Home`); a bare `/buy` as a reply consumes the
    // quoted message — with privacy ON that quote is the only way a
    // plain-text product list reaches the bot.
    const quoted = message.reply_to_message?.text?.trim() ?? "";
    const source = text !== "" ? text : quoted;
    // Linked users get grocery intents (T63): unknown phrasing helps in
    // private chats and stays silent in groups (never spam a group).
    const answer = await handleTelegramChat(
      db,
      link.userId,
      source,
      chatType === "private",
      quoted,
      {
        extractor: options.extractor,
        confidenceThreshold: options.confidenceThreshold,
      },
    );
    if (answer.silent || !answer.text) {
      return reply.send({ ok: true });
    }
    await sendQuietly(request, sender, chatId, answer.text, miniAppUrl);
    return reply.send({ ok: true });
  });
}

/**
 * Sends a reply without ever failing the webhook: a failed `sendMessage`
 * must not turn into a Telegram retry storm, so errors are logged and the
 * update is still acked.
 */
async function sendQuietly(
  request: { log: { warn: (obj: unknown, msg: string) => void } },
  sender: BotSender,
  chatId: number,
  text: string,
  miniAppUrl: string,
): Promise<void> {
  try {
    await sender(chatId, text, miniAppUrl ? { openAppUrl: miniAppUrl } : undefined);
  } catch (error) {
    request.log.warn({ err: error, chatId }, "telegram sendMessage failed");
  }
}
