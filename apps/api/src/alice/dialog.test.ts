import { createId } from "@paralleldrive/cuid2";
import { hashSync } from "bcryptjs";
import type { FastifyInstance } from "fastify";
import { beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { loadConfig } from "../config";
import { type Db, createDb, createSqlite } from "../db/client";
import { runMigrations } from "../db/migrate";
import { users } from "../db/schema";
import { issueTokenPair } from "../oauth/oauthService";
import { createItem, listItems } from "../services/itemService";
import { createList } from "../services/listService";
import { ALICE_LIST_OFFSET_KEY, aliceResponseSchema } from "./protocol";

const SKILL_ID = "test-skill-dialog";

let app: FastifyInstance;
let db: Db;

let userId: string;
let listId: string;
let token: string;

let capUserId: string;
let capListId: string;
let capToken: string;

function createUser(email: string): string {
  const id = createId();
  db.insert(users)
    .values({ id, email, passwordHash: hashSync("password-123", 10), role: "user" })
    .run();
  return id;
}

function buildPayload(params: {
  command?: string;
  nlu?: Record<string, unknown>;
  markup?: Record<string, unknown>;
  locale?: string;
  sessionState?: Record<string, unknown>;
}): Record<string, unknown> {
  const { command = "что купить", nlu, markup, locale = "ru-RU", sessionState = {} } = params;
  const request: Record<string, unknown> = {
    type: "SimpleUtterance",
    command,
    original_utterance: command,
    nlu: nlu ?? { tokens: command.split(" "), entities: [] },
  };
  if (markup !== undefined) {
    request.markup = markup;
  }
  return {
    meta: {
      locale,
      timezone: "Europe/Moscow",
      interfaces: { account_linking: {}, screen: {} },
    },
    session: {
      session_id: "session-1",
      message_id: 1,
      skill_id: SKILL_ID,
      application: { application_id: "app-1" },
      user: { user_id: "yandex-user-1" },
      new: false,
    },
    request,
    state: { session: sessionState },
    version: "1.0",
  };
}

function post(payload: Record<string, unknown>, authToken?: string) {
  return app.inject({
    method: "POST",
    url: "/alice/webhook",
    payload,
    headers: authToken === undefined ? {} : { authorization: `Bearer ${authToken}` },
  });
}

beforeAll(async () => {
  const sqlite = createSqlite(":memory:");
  db = createDb(sqlite);
  runMigrations(db);
  app = buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", ALICE_SKILL_ID: SKILL_ID }), {
    db,
  });
  await app.ready();

  userId = createUser("alice-dialog@example.com");
  listId = createList(db, userId, "Покупки").id;
  token = issueTokenPair(db, { userId, clientId: "alice" }).accessToken;
  createItem(db, listId, { title: "Молоко" });
  createItem(db, listId, { title: "Хлеб" });

  capUserId = createUser("alice-dialog-cap@example.com");
  capListId = createList(db, capUserId, "Покупки").id;
  capToken = issueTokenPair(db, { userId: capUserId, clientId: "alice" }).accessToken;
  for (let i = 1; i <= 8; i++) {
    createItem(db, capListId, { title: `Товар${i}` });
  }
});

describe("Alice grocery: list intent", () => {
  it("reads TO_BUY with stressed tts", async () => {
    const res = await post(buildPayload({ command: "что купить" }), token);
    expect(res.statusCode).toBe(200);
    const json = aliceResponseSchema.parse(res.json());
    expect(json.response?.text).toContain("Молоко");
    expect(json.response?.text).toContain("Хлеб");
    expect(json.response?.tts).toContain("+");
  });

  it("answers the link card when unlinked", async () => {
    const res = await post(buildPayload({ command: "что купить" }));
    expect(aliceResponseSchema.parse(res.json()).start_account_linking).toEqual({});
  });

  it("answers the link card on an invalid token", async () => {
    const res = await post(buildPayload({ command: "что купить" }), "bogus-token");
    expect(aliceResponseSchema.parse(res.json()).start_account_linking).toEqual({});
  });

  it("caps spoken lists with «ещё N — скажите дальше»", async () => {
    const res = await post(buildPayload({ command: "что купить" }), capToken);
    const json = aliceResponseSchema.parse(res.json());
    expect(json.response?.text).toContain("ещё 3");
    expect(json.response?.text).toContain("дальше");
    expect(json.response?.tts).toContain("+");
    expect(json.session_state?.[ALICE_LIST_OFFSET_KEY]).toBe(5);
  });
});

describe("Alice grocery: add intent", () => {
  it("smart-adds into the bound list with a one-word ack", async () => {
    const res = await post(buildPayload({ command: "добавь кефир" }), token);
    expect(res.statusCode).toBe(200);
    expect(aliceResponseSchema.parse(res.json()).response?.text).toBe("Добавлено.");
    expect(
      listItems(db, listId, "TO_BUY").some((item) => item.title.toLowerCase() === "кефир"),
    ).toBe(true);
  });

  it("answers duplicates with «Уже в списке.»", async () => {
    await post(buildPayload({ command: "добавь кефир" }), token);
    const res = await post(buildPayload({ command: "добавь кефир" }), token);
    expect(aliceResponseSchema.parse(res.json()).response?.text).toBe("Уже в списке.");
  });

  it("uses YANDEX.NUMBER for the quantity", async () => {
    const res = await post(
      buildPayload({
        command: "добавь 2 молока",
        nlu: {
          tokens: ["добавь", "2", "молока"],
          entities: [{ tokens: { start: 1, end: 2 }, type: "YANDEX.NUMBER", value: 2 }],
        },
      }),
      token,
    );
    expect(res.statusCode).toBe(200);
    expect(aliceResponseSchema.parse(res.json()).response?.text).toBeDefined();
  });

  it("answers the link card when unlinked", async () => {
    const res = await post(buildPayload({ command: "добавь молоко" }));
    expect(aliceResponseSchema.parse(res.json()).start_account_linking).toEqual({});
  });

  it("answers the link card on an invalid token", async () => {
    const res = await post(buildPayload({ command: "добавь молоко" }), "bogus-token");
    expect(aliceResponseSchema.parse(res.json()).start_account_linking).toEqual({});
  });
});

describe("Alice grocery: buy intent", () => {
  it("moves to BOUGHT with a one-word ack (T48 top-of-bought applies)", async () => {
    const first = await post(buildPayload({ command: "купили хлеб" }), token);
    expect(aliceResponseSchema.parse(first.json()).response?.text).toBe("Куплено.");
    const second = await post(buildPayload({ command: "купили молоко" }), token);
    expect(aliceResponseSchema.parse(second.json()).response?.text).toBe("Куплено.");
    const bought = listItems(db, listId, "BOUGHT");
    expect(bought.map((item) => item.title)).toEqual(expect.arrayContaining(["Молоко", "Хлеб"]));
    // Buy-then-buy: the later purchase lands on top (T48).
    expect(bought[0]?.title).toBe("Молоко");
  });

  it("clarifies unknown names instead of moving", async () => {
    const before = listItems(db, listId, "TO_BUY").length;
    const res = await post(buildPayload({ command: "купили драконфрукт" }), token);
    expect(aliceResponseSchema.parse(res.json()).response?.text).toContain("Не нашла");
    expect(listItems(db, listId, "TO_BUY").length).toBe(before);
  });

  it("answers the link card when unlinked", async () => {
    const res = await post(buildPayload({ command: "купили молоко" }));
    expect(aliceResponseSchema.parse(res.json()).start_account_linking).toEqual({});
  });

  it("answers the link card on an invalid token", async () => {
    const res = await post(buildPayload({ command: "купили молоко" }), "bogus-token");
    expect(aliceResponseSchema.parse(res.json()).start_account_linking).toEqual({});
  });
});

describe("Alice grocery: unbuy intent", () => {
  it("moves back to TO_BUY with a one-word ack", async () => {
    const res = await post(buildPayload({ command: "верни молоко" }), token);
    expect(res.statusCode).toBe(200);
    expect(aliceResponseSchema.parse(res.json()).response?.text).toBe("В покупках.");
    expect(listItems(db, listId, "TO_BUY").some((item) => item.title === "Молоко")).toBe(true);
  });

  it("clarifies unknown names instead of moving", async () => {
    const res = await post(buildPayload({ command: "верни драконфрукт" }), token);
    expect(aliceResponseSchema.parse(res.json()).response?.text).toContain("Не нашла");
  });

  it("answers the link card when unlinked", async () => {
    const res = await post(buildPayload({ command: "верни молоко" }));
    expect(aliceResponseSchema.parse(res.json()).start_account_linking).toEqual({});
  });

  it("answers the link card on an invalid token", async () => {
    const res = await post(buildPayload({ command: "верни молоко" }), "bogus-token");
    expect(aliceResponseSchema.parse(res.json()).start_account_linking).toEqual({});
  });
});

describe("Alice grocery: dangerous context", () => {
  it("replies gracefully without touching the list", async () => {
    const before = listItems(db, listId, "TO_BUY").length;
    const res = await post(
      buildPayload({ command: "купили молоко", markup: { dangerous_context: true } }),
      token,
    );
    expect(aliceResponseSchema.parse(res.json()).response?.text).toContain("переформулируйте");
    expect(listItems(db, listId, "TO_BUY").length).toBe(before);
  });
});

describe("T79 concise acks + paginated readout", () => {
  it("answers EN acks for add/dup/buy/unbuy", async () => {
    const added = await post(buildPayload({ command: "добавь папайя", locale: "en-US" }), token);
    expect(aliceResponseSchema.parse(added.json()).response?.text).toBe("Added.");
    const dup = await post(buildPayload({ command: "добавь папайя", locale: "en-US" }), token);
    expect(aliceResponseSchema.parse(dup.json()).response?.text).toBe("Already on it.");
    const bought = await post(buildPayload({ command: "купили папайя", locale: "en-US" }), token);
    expect(aliceResponseSchema.parse(bought.json()).response?.text).toBe("Done.");
    const unbought = await post(buildPayload({ command: "верни папайя", locale: "en-US" }), token);
    expect(aliceResponseSchema.parse(unbought.json()).response?.text).toBe("Back on the list.");
  });

  it("reads newest-first in pages of 5 with «дальше» continuation and end-of-list", async () => {
    const pageUser = createUser("alice-dialog-page@example.com");
    const pageList = createList(db, pageUser, "Покупки").id;
    const pageToken = issueTokenPair(db, { userId: pageUser, clientId: "alice" }).accessToken;
    const base = Date.now();
    for (let i = 1; i <= 12; i++) {
      createItem(db, pageList, { title: `Ед${i}` }, new Date(base + i * 1000));
    }
    const first = await post(buildPayload({ command: "что купить" }), pageToken);
    const firstJson = aliceResponseSchema.parse(first.json());
    expect(firstJson.response?.text).toContain("Ед12");
    expect(firstJson.response?.text).toContain("Ед8");
    expect(firstJson.response?.text).not.toContain("Ед7");
    expect(firstJson.response?.text).toContain("ещё 7");
    expect(firstJson.response?.tts).toContain("+");
    expect(firstJson.session_state?.[ALICE_LIST_OFFSET_KEY]).toBe(5);

    const second = await post(
      buildPayload({
        command: "дальше",
        sessionState: { [ALICE_LIST_OFFSET_KEY]: 5 },
      }),
      pageToken,
    );
    const secondJson = aliceResponseSchema.parse(second.json());
    expect(secondJson.response?.text).toContain("Ед7");
    expect(secondJson.response?.text).toContain("Ед3");
    expect(secondJson.response?.text).not.toContain("Ед2");
    expect(secondJson.session_state?.[ALICE_LIST_OFFSET_KEY]).toBe(10);

    const third = await post(
      buildPayload({
        command: "дальше",
        sessionState: { [ALICE_LIST_OFFSET_KEY]: 10 },
      }),
      pageToken,
    );
    const thirdJson = aliceResponseSchema.parse(third.json());
    expect(thirdJson.response?.text).toContain("Ед2");
    expect(thirdJson.response?.text).toContain("Ед1");
    expect(thirdJson.response?.text).toContain("Это всё.");

    const tail = await post(
      buildPayload({
        command: "дальше",
        sessionState: { [ALICE_LIST_OFFSET_KEY]: 12 },
      }),
      pageToken,
    );
    expect(aliceResponseSchema.parse(tail.json()).response?.text).toBe("Это всё.");
  });

  it("resets the offset after a mutation", async () => {
    const pageUser = createUser("alice-dialog-reset@example.com");
    const pageList = createList(db, pageUser, "Покупки").id;
    const pageToken = issueTokenPair(db, { userId: pageUser, clientId: "alice" }).accessToken;
    const oldBase = Date.now() - 100_000;
    for (let i = 1; i <= 6; i++) {
      createItem(db, pageList, { title: `Прод${i}` }, new Date(oldBase + i * 1000));
    }
    const listed = await post(buildPayload({ command: "что купить" }), pageToken);
    expect(aliceResponseSchema.parse(listed.json()).session_state?.[ALICE_LIST_OFFSET_KEY]).toBe(5);
    const added = await post(buildPayload({ command: "добавь новинка" }), pageToken);
    const addedJson = aliceResponseSchema.parse(added.json());
    expect(addedJson.response?.text).toBe("Добавлено.");
    expect(addedJson.session_state?.[ALICE_LIST_OFFSET_KEY]).toBe(0);
    const relisted = await post(buildPayload({ command: "что купить" }), pageToken);
    const relistedJson = aliceResponseSchema.parse(relisted.json());
    expect(relistedJson.response?.text).toContain("новинка");
    expect(relistedJson.session_state?.[ALICE_LIST_OFFSET_KEY]).toBe(5);
  });
});
