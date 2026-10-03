import { createId } from "@paralleldrive/cuid2";
import Fastify, { type FastifyInstance } from "fastify";
import { beforeAll, describe, expect, it } from "vitest";
import { type Db, createDb, createSqlite } from "../db/client";
import { runMigrations } from "../db/migrate";
import { users } from "../db/schema";
import { registerDb } from "../plugins/db";
import { applyErrorHandling } from "../plugins/error-handler";
import { createList } from "../services/listService";
import { BOT_LINK_PROMPT_TEXT, botWebhookRoutes, extractCommandText } from "./botWebhook";
import { linkTelegramAccount } from "./service";

const WEBHOOK_SECRET = "test-webhook-secret";
const MINI_APP_URL = "https://grocery.example.com/";

type SentMessage = { chatId: number; text: string; opts?: { openAppUrl?: string } };

let app: FastifyInstance;
let db: Db;
let sent: SentMessage[];

function messageUpdate(params: {
  text?: string;
  chatId?: number;
  chatType?: string;
  fromId?: number;
  isBot?: boolean;
}): Record<string, unknown> {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      from: { id: params.fromId ?? 279058397, is_bot: params.isBot ?? false },
      chat: { id: params.chatId ?? 100, type: params.chatType ?? "private" },
      ...(params.text === undefined ? {} : { text: params.text }),
    },
  };
}

function postUpdate(
  body: Record<string, unknown>,
  secret: string | null = WEBHOOK_SECRET,
): Promise<{ statusCode: number; json: () => unknown }> {
  return app.inject({
    method: "POST",
    url: "/telegram/bot-webhook",
    headers: secret === null ? {} : { "x-telegram-bot-api-secret-token": secret },
    payload: body,
  });
}

beforeAll(async () => {
  const sqlite = createSqlite(":memory:");
  db = createDb(sqlite);
  runMigrations(db);
  const userId = createId();
  db.insert(users)
    .values({ id: userId, email: "tg-chat@example.com", passwordHash: "dummy", role: "user" })
    .run();
  linkTelegramAccount(db, userId, "279058397");
  createList(db, userId, "TG List");

  sent = [];
  app = Fastify({ logger: false });
  applyErrorHandling(app);
  registerDb(app, db);
  await app.register(botWebhookRoutes, {
    botToken: "test-token",
    webhookSecret: WEBHOOK_SECRET,
    miniAppUrl: MINI_APP_URL,
    sender: async (chatId, text, opts) => {
      sent.push({ chatId, text, opts });
    },
  });
  await app.ready();
});

describe("extractCommandText (T62)", () => {
  it("passes private text through untouched", () => {
    expect(extractCommandText("купи молоко")).toEqual({ text: "купи молоко", addressed: false });
  });

  it("strips a leading @mention and marks the message addressed", () => {
    expect(extractCommandText("@grocerybot купи молоко")).toEqual({
      text: "купи молоко",
      addressed: true,
    });
  });

  it("strips leading /commands (/start, /buy@bot milk)", () => {
    expect(extractCommandText("/start")).toEqual({ text: "", addressed: true });
    expect(extractCommandText("/buy@mybot 2 milk")).toEqual({ text: "2 milk", addressed: true });
  });
});

describe("POST /telegram/bot-webhook (T62 plumbing + gating)", () => {
  it("rejects a wrong secret with 401 and sends nothing", async () => {
    sent = [];
    const res = await postUpdate(messageUpdate({ text: "hi" }), "wrong-secret");
    expect(res.statusCode).toBe(401);
    expect(sent).toHaveLength(0);
  });

  it("rejects a missing secret with 401", async () => {
    const res = await postUpdate(messageUpdate({ text: "hi" }), null);
    expect(res.statusCode).toBe(401);
  });

  it("acks malformed updates without sending", async () => {
    sent = [];
    const res = await postUpdate({ garbage: true });
    expect(res.statusCode).toBe(200);
    expect(sent).toHaveLength(0);
  });

  it("acks bot-sent and non-text messages silently", async () => {
    sent = [];
    expect((await postUpdate(messageUpdate({ text: "hi", isBot: true }))).statusCode).toBe(200);
    expect((await postUpdate(messageUpdate({}))).statusCode).toBe(200);
    expect(sent).toHaveLength(0);
  });

  it("stays silent on unaddressed group chatter", async () => {
    sent = [];
    const res = await postUpdate(
      messageUpdate({ text: "buy apples", chatType: "group", chatId: 200 }),
    );
    expect(res.statusCode).toBe(200);
    expect(sent).toHaveLength(0);
  });

  it("prompts unlinked senders to link (with the open-app button), mutating nothing", async () => {
    sent = [];
    const res = await postUpdate(messageUpdate({ text: "buy apples", fromId: 999 }));
    expect(res.statusCode).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toBe(BOT_LINK_PROMPT_TEXT);
    expect(sent[0]?.opts).toEqual({ openAppUrl: MINI_APP_URL });
  });

  it("routes linked users to grocery intents end to end (T63)", async () => {
    sent = [];
    const res = await postUpdate(messageUpdate({ text: "buy apples" }));
    expect(res.statusCode).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toBe('Added "apples" to "TG List".');
    expect(sent[0]?.opts).toEqual({ openAppUrl: MINI_APP_URL });
  });

  it("answers a bare /start with help in private, silence in groups", async () => {
    sent = [];
    await postUpdate(messageUpdate({ text: "/start" }));
    expect(sent).toHaveLength(1);
    sent = [];
    await postUpdate(messageUpdate({ text: "@bot /start", chatType: "group", chatId: 201 }));
    expect(sent).toHaveLength(0);
  });
});
