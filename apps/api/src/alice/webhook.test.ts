import { createId } from "@paralleldrive/cuid2";
import { hashSync } from "bcryptjs";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { loadConfig } from "../config";
import { type Db, createDb, createSqlite } from "../db/client";
import { runMigrations } from "../db/migrate";
import { oauthTokens, users } from "../db/schema";
import { issueTokenPair } from "../oauth/oauthService";
import { hashToken } from "../services/authService";
import { createList, deleteList } from "../services/listService";
import { getAliceLink } from "./links";
import {
  ALICE_AWAITING_CHOICE_KEY,
  ALICE_PENDING_COMMAND_KEY,
  aliceResponseSchema,
} from "./protocol";

const SKILL_ID = "test-skill-1";

let app: FastifyInstance;
let db: Db;

let soloUserId: string;
let soloListId: string;
let soloToken: string;
let multiUserId: string;
let multiFirstId: string;
let multiSecondId: string;
let multiToken: string;
let bareUserId: string;
let bareToken: string;

function createUser(email: string): string {
  const id = createId();
  db.insert(users)
    .values({ id, email, passwordHash: hashSync("password-123", 10), role: "user" })
    .run();
  return id;
}

function issueAliceToken(userId: string): string {
  return issueTokenPair(db, { userId, clientId: "alice" }).accessToken;
}

function expireAccessToken(accessToken: string): void {
  db.update(oauthTokens)
    .set({ accessExpiresAt: new Date(Date.now() - 1000) })
    .where(eq(oauthTokens.accessTokenHash, hashToken(accessToken)))
    .run();
}

function buildPayload(params: {
  command?: string;
  requestType?: string;
  sessionNew?: boolean;
  skillId?: string;
  sessionToken?: string;
  sessionState?: Record<string, unknown>;
  withLinkingInterface?: boolean;
}): Record<string, unknown> {
  const {
    command = "что купить",
    requestType = "SimpleUtterance",
    sessionNew = false,
    skillId = SKILL_ID,
    sessionToken,
    sessionState = {},
    withLinkingInterface = true,
  } = params;
  return {
    meta: {
      locale: "ru-RU",
      timezone: "Europe/Moscow",
      interfaces: withLinkingInterface ? { account_linking: {}, screen: {} } : { screen: {} },
    },
    session: {
      session_id: "session-1",
      message_id: 1,
      skill_id: skillId,
      application: { application_id: "app-1" },
      user:
        sessionToken === undefined
          ? { user_id: "yandex-user-1" }
          : { user_id: "yandex-user-1", access_token: sessionToken },
      new: sessionNew,
    },
    request: {
      type: requestType,
      command,
      original_utterance: command,
      nlu: { tokens: command.split(" "), entities: [] },
    },
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

  soloUserId = createUser("alice-solo@example.com");
  soloListId = createList(db, soloUserId, "Покупки").id;
  soloToken = issueAliceToken(soloUserId);

  multiUserId = createUser("alice-multi@example.com");
  multiFirstId = createList(db, multiUserId, "Покупки").id;
  multiSecondId = createList(db, multiUserId, "Дача").id;
  multiToken = issueAliceToken(multiUserId);

  bareUserId = createUser("alice-bare@example.com");
  bareToken = issueAliceToken(bareUserId);
});

describe("POST /alice/webhook — caller verification", () => {
  it("rejects a foreign skill_id with 403", async () => {
    const res = await post(buildPayload({ skillId: "foreign-skill" }));
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  it("rejects a malformed body with 400", async () => {
    const res = await post({ nonsense: true });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });
});

describe("public intents (no auth required)", () => {
  it("answers welcome on a new session without the link card", async () => {
    const res = await post(buildPayload({ sessionNew: true, command: "" }));
    expect(res.statusCode).toBe(200);
    const json = aliceResponseSchema.parse(res.json());
    expect(json.response?.text).toContain("Привет");
    expect(json).not.toHaveProperty("start_account_linking");
  });

  it("answers help without auth", async () => {
    const res = await post(buildPayload({ command: "Помощь" }));
    expect(res.statusCode).toBe(200);
    const json = aliceResponseSchema.parse(res.json());
    expect(json.response?.text).toContain("умею");
    expect(json).not.toHaveProperty("start_account_linking");
  });
});

describe("link gating (unlinked private intent)", () => {
  it("answers the link card ALONE and saves the pending request", async () => {
    const res = await post(buildPayload({ command: "что купить" }));
    expect(res.statusCode).toBe(200);
    const json = aliceResponseSchema.parse(res.json());
    expect(json.start_account_linking).toEqual({});
    expect(json).not.toHaveProperty("response");
    expect(json.session_state?.[ALICE_PENDING_COMMAND_KEY]).toBe("что купить");
  });

  it("never sends the card on surfaces without account_linking", async () => {
    const res = await post(buildPayload({ withLinkingInterface: false }));
    expect(res.statusCode).toBe(200);
    const json = aliceResponseSchema.parse(res.json());
    expect(json).not.toHaveProperty("start_account_linking");
    expect(json.response?.text).toContain("не поддерживает привязку");
  });

  it("answers the link card again on an invalid token", async () => {
    const res = await post(buildPayload({}), "bogus-token");
    expect(res.statusCode).toBe(200);
    const json = aliceResponseSchema.parse(res.json());
    expect(json.start_account_linking).toEqual({});
    expect(json).not.toHaveProperty("response");
  });

  it("answers the link card again on an expired token", async () => {
    const userId = createUser("alice-expiring@example.com");
    const token = issueAliceToken(userId);
    expireAccessToken(token);
    const res = await post(buildPayload({}), token);
    expect(res.statusCode).toBe(200);
    expect(aliceResponseSchema.parse(res.json()).start_account_linking).toEqual({});
  });
});

describe("linked requests (token → user, guards apply)", () => {
  it("resolves the user from the Authorization header and auto-binds one list", async () => {
    const res = await post(buildPayload({}), soloToken);
    expect(res.statusCode).toBe(200);
    const json = aliceResponseSchema.parse(res.json());
    expect(json).not.toHaveProperty("start_account_linking");
    expect(json.response?.text).toBeDefined();
    expect(getAliceLink(db, soloUserId)).toBe(soloListId);
  });

  it("resolves the user from session.user.access_token", async () => {
    const freshToken = issueAliceToken(soloUserId);
    const res = await post(buildPayload({ sessionToken: freshToken }));
    expect(res.statusCode).toBe(200);
    expect(aliceResponseSchema.parse(res.json()).response?.text).toBeDefined();
  });

  it("reports no_lists for a linked user without lists", async () => {
    const res = await post(buildPayload({}), bareToken);
    expect(res.statusCode).toBe(200);
    const json = aliceResponseSchema.parse(res.json());
    expect(json.response?.text).toContain("нет ни одного списка");
  });
});

describe("single-list binding (ask-once via session_state)", () => {
  it("asks once when several lists are accessible, binding nothing yet", async () => {
    const res = await post(buildPayload({}), multiToken);
    expect(res.statusCode).toBe(200);
    const json = aliceResponseSchema.parse(res.json());
    expect(json.response?.text).toContain("Какой список");
    expect(json.session_state?.[ALICE_AWAITING_CHOICE_KEY]).toBe(true);
    expect(getAliceLink(db, multiUserId)).toBeUndefined();
  });

  it("binds the spoken list title and confirms (case-insensitive)", async () => {
    const res = await post(
      buildPayload({
        command: "ДАЧА",
        sessionState: { [ALICE_AWAITING_CHOICE_KEY]: true },
      }),
      multiToken,
    );
    expect(res.statusCode).toBe(200);
    const json = aliceResponseSchema.parse(res.json());
    expect(json.response?.text).toContain("Дача");
    expect(getAliceLink(db, multiUserId)).toBe(multiSecondId);
  });

  it("rebinds silently when the bound list is gone and one remains", async () => {
    deleteList(db, multiSecondId);
    const res = await post(buildPayload({}), multiToken);
    expect(res.statusCode).toBe(200);
    expect(aliceResponseSchema.parse(res.json()).response?.text).toBeDefined();
    expect(getAliceLink(db, multiUserId)).toBe(multiFirstId);
  });
});

describe("account_linking_complete_event (pending replay)", () => {
  it("answers the saved request without repetition once linked", async () => {
    const gated = await post(buildPayload({ command: "что купить" }));
    const savedState = aliceResponseSchema.parse(gated.json()).session_state as Record<
      string,
      unknown
    >;
    expect(savedState[ALICE_PENDING_COMMAND_KEY]).toBe("что купить");

    const res = await post(
      buildPayload({
        requestType: "AccountLinkingCompleteEvent",
        command: "",
        sessionState: savedState,
        sessionToken: soloToken,
      }),
    );
    expect(res.statusCode).toBe(200);
    const json = aliceResponseSchema.parse(res.json());
    expect(json).not.toHaveProperty("start_account_linking");
    expect(json.response?.text).toBeDefined();
  });

  it("greets when the complete event carries no pending request", async () => {
    const res = await post(
      buildPayload({ requestType: "AccountLinkingCompleteEvent", command: "" }),
      soloToken,
    );
    expect(res.statusCode).toBe(200);
    expect(aliceResponseSchema.parse(res.json()).response?.text).toContain("привязан");
  });

  it("answers the link card again when the complete event is unlinked", async () => {
    const res = await post(
      buildPayload({ requestType: "AccountLinkingCompleteEvent", command: "" }),
      "bogus-token",
    );
    expect(res.statusCode).toBe(200);
    expect(aliceResponseSchema.parse(res.json()).start_account_linking).toEqual({});
  });
});
