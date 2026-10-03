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

type SentMessage = {
  chatId: number;
  text: string;
  opts?: { openAppUrl?: string; choices?: { listId: string; title: string }[] };
};

let app: FastifyInstance;
let db: Db;
let sent: SentMessage[];
let answered: string[];

function messageUpdate(params: {
  text?: string;
  chatId?: number;
  chatType?: string;
  fromId?: number;
  isBot?: boolean;
  replyToText?: string;
}): Record<string, unknown> {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      from: { id: params.fromId ?? 279058397, is_bot: params.isBot ?? false },
      chat: { id: params.chatId ?? 100, type: params.chatType ?? "private" },
      ...(params.text === undefined ? {} : { text: params.text }),
      ...(params.replyToText === undefined
        ? {}
        : { reply_to_message: { message_id: 0, text: params.replyToText } }),
    },
  };
}

function callbackUpdate(params: {
  data?: string;
  chatId?: number;
  fromId?: number;
  isBot?: boolean;
  withMessage?: boolean;
}): Record<string, unknown> {
  return {
    update_id: 2,
    callback_query: {
      id: "cq-1",
      from: { id: params.fromId ?? 279058397, is_bot: params.isBot ?? false },
      ...(params.withMessage === false
        ? {}
        : { message: { message_id: 5, chat: { id: params.chatId ?? 100, type: "private" } } }),
      ...(params.data === undefined ? {} : { data: params.data }),
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
  answered = [];
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
    answerCallback: async (id) => {
      answered.push(id);
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
    expect(extractCommandText("/start")).toEqual({ text: "start", addressed: true });
    expect(extractCommandText("/buy@mybot 2 milk")).toEqual({ text: "2 milk", addressed: true });
  });

  it("keeps bare informational commands, still strips bare grocery verbs (T72)", () => {
    expect(extractCommandText("/list")).toEqual({ text: "list", addressed: true });
    expect(extractCommandText("/lists")).toEqual({ text: "lists", addressed: true });
    expect(extractCommandText("/grocery_lists")).toEqual({
      text: "grocery_lists",
      addressed: true,
    });
    expect(extractCommandText("/help")).toEqual({ text: "help", addressed: true });
    // Bare verbs strip to "" so /buy-as-reply keeps consuming the quote (T65).
    expect(extractCommandText("/buy")).toEqual({ text: "", addressed: true });
    expect(extractCommandText("/bought")).toEqual({ text: "", addressed: true });
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

  it("consumes the quoted list on a bare reply-/buy (T65 scenarios 2–3)", async () => {
    sent = [];
    const res = await postUpdate(messageUpdate({ text: "/buy", replyToText: "milk\nbread" }));
    expect(res.statusCode).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toBe('Added "milk", "bread" to "TG List".');
  });

  it("prefers the command text over the quote (suffix routing in replies)", async () => {
    sent = [];
    const res = await postUpdate(messageUpdate({ text: "/buy in TG List", replyToText: "kefir" }));
    expect(res.statusCode).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toBe('Added "kefir" to "TG List".');
  });

  it("routes deterministic-unknown text through the configured extractor (T66)", async () => {
    const extractorSent: SentMessage[] = [];
    const extractorApp = Fastify({ logger: false });
    applyErrorHandling(extractorApp);
    registerDb(extractorApp, db);
    await extractorApp.register(botWebhookRoutes, {
      botToken: "test-token",
      webhookSecret: WEBHOOK_SECRET,
      miniAppUrl: MINI_APP_URL,
      sender: async (chatId, text, opts) => {
        extractorSent.push({ chatId, text, opts });
      },
      extractor: { extractAction: async () => ({ action: "add", confidence: 0.9 }) },
    });
    await extractorApp.ready();
    try {
      const res = await extractorApp.inject({
        method: "POST",
        url: "/telegram/bot-webhook",
        headers: { "x-telegram-bot-api-secret-token": WEBHOOK_SECRET },
        payload: messageUpdate({ text: "something for pancakes" }),
      });
      expect(res.statusCode).toBe(200);
      expect(extractorSent).toHaveLength(1);
      expect(extractorSent[0]?.text).toBe('Added "something for pancakes" to "TG List".');
    } finally {
      await extractorApp.close();
    }
  });

  it("answers a bare /start with help in private, silence in groups", async () => {
    sent = [];
    await postUpdate(messageUpdate({ text: "/start" }));
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toContain("/grocery_lists");
    sent = [];
    await postUpdate(messageUpdate({ text: "@bot /start", chatType: "group", chatId: 201 }));
    expect(sent).toHaveLength(0);
  });

  it("answers bare /list and /lists end to end (T72)", async () => {
    sent = [];
    await postUpdate(messageUpdate({ text: "/list" }));
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toContain("TG List");
    sent = [];
    await postUpdate(messageUpdate({ text: "/lists" }));
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toContain("TG List");
    sent = [];
    await postUpdate(messageUpdate({ text: "/grocery_lists" }));
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toContain("TG List");
    sent = [];
    await postUpdate(messageUpdate({ text: "/list", chatType: "group", chatId: 202 }));
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toContain("TG List");
  });
});

describe("POST /telegram/bot-webhook callback_query (T70 tap-to-select)", () => {
  const tapper = 555111;
  let alphaId: string;
  let betaId: string;
  let gammaId: string;

  beforeAll(async () => {
    const userId = createId();
    db.insert(users)
      .values({ id: userId, email: "tg-tap@example.com", passwordHash: "dummy", role: "user" })
      .run();
    linkTelegramAccount(db, userId, String(tapper));
    alphaId = createList(db, userId, "Alpha").id;
    betaId = createList(db, userId, "Beta").id;
    const outsider = createId();
    db.insert(users)
      .values({
        id: outsider,
        email: "tg-tap-out@example.com",
        passwordHash: "dummy",
        role: "user",
      })
      .run();
    gammaId = createList(db, outsider, "Gamma").id;
  });

  it("rejects callbacks with a wrong secret (401, nothing sent, spinner untouched)", async () => {
    sent = [];
    answered = [];
    const res = await postUpdate(
      callbackUpdate({ chatId: 320, fromId: tapper, data: `tg-use:${alphaId}` }),
      "wrong-secret",
    );
    expect(res.statusCode).toBe(401);
    expect(sent).toHaveLength(0);
    expect(answered).toHaveLength(0);
  });

  it("stores the tapped list, confirms, and routes the next bare command there", async () => {
    sent = [];
    answered = [];
    const res = await postUpdate(
      callbackUpdate({ chatId: 321, fromId: tapper, data: `tg-use:${betaId}` }),
    );
    expect(res.statusCode).toBe(200);
    expect(answered).toEqual(["cq-1"]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toContain("Beta");
    expect(sent[0]?.opts).toEqual({ openAppUrl: MINI_APP_URL });
    sent = [];
    const follow = await postUpdate(
      messageUpdate({ text: "buy kiwi", chatId: 321, fromId: tapper }),
    );
    expect(follow.statusCode).toBe(200);
    expect(sent[0]?.text).toBe('Added "kiwi" to "Beta".');
  });

  it("attaches tap choices to need_choice and /lists replies", async () => {
    sent = [];
    await postUpdate(messageUpdate({ text: "buy plum", chatId: 322, fromId: tapper }));
    expect(sent[0]?.opts?.choices?.map((c) => c.title).sort()).toEqual(["Alpha", "Beta"]);
    sent = [];
    await postUpdate(messageUpdate({ text: "/lists", chatId: 322, fromId: tapper }));
    expect(sent[0]?.opts?.choices?.map((c) => c.title).sort()).toEqual(["Alpha", "Beta"]);
  });

  it("degrades gracefully on deleted list ids", async () => {
    sent = [];
    const res = await postUpdate(
      callbackUpdate({ chatId: 323, fromId: tapper, data: "tg-use:no-such-list" }),
    );
    expect(res.statusCode).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toContain("gone");
  });

  it("refuses taps on lists the tapper cannot access", async () => {
    sent = [];
    const res = await postUpdate(
      callbackUpdate({ chatId: 324, fromId: tapper, data: `tg-use:${gammaId}` }),
    );
    expect(res.statusCode).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toContain("No access");
  });

  it("prompts unlinked tappers to link, storing nothing", async () => {
    sent = [];
    const res = await postUpdate(
      callbackUpdate({ chatId: 325, fromId: 999888, data: `tg-use:${alphaId}` }),
    );
    expect(res.statusCode).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toBe(BOT_LINK_PROMPT_TEXT);
  });

  it("acks unknown button payloads silently", async () => {
    sent = [];
    answered = [];
    expect(
      (await postUpdate(callbackUpdate({ chatId: 326, fromId: tapper, data: "nope" }))).statusCode,
    ).toBe(200);
    expect(
      (await postUpdate(callbackUpdate({ chatId: 326, fromId: tapper, withMessage: false })))
        .statusCode,
    ).toBe(200);
    expect(sent).toHaveLength(0);
    expect(answered).toEqual(["cq-1", "cq-1"]);
  });
});
