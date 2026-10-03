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
import { createList } from "../services/listService";
import { ALICE_MAX_TEXT_LENGTH, ALICE_PENDING_COMMAND_KEY, aliceResponseSchema } from "./protocol";

/**
 * T53 simulator pass: the exact console-simulator flow from the Definition of
 * Done — link → welcome → add → list → buy → unbuy — against the real
 * webhook via `inject`, plus dismiss/revoke → relink. Every turn must answer
 * within the local latency budget (leaving headroom for the tunnel inside
 * Yandex's response limit) with a protocol-valid body.
 */

// Local per-turn budget: Yandex enforces a few-second webhook limit, so the
// in-process handler must stay far below it; the remainder is tunnel budget.
const TURN_BUDGET_MS = 1000;

const SKILL_ID = "test-skill-simulator";

let app: FastifyInstance;
let db: Db;

let userId: string;
let token: string;

function buildPayload(params: {
  command?: string;
  requestType?: string;
  sessionNew?: boolean;
  sessionToken?: string;
  sessionState?: Record<string, unknown>;
}): Record<string, unknown> {
  const {
    command = "что купить",
    requestType = "SimpleUtterance",
    sessionNew = false,
    sessionToken,
    sessionState = {},
  } = params;
  return {
    meta: {
      locale: "ru-RU",
      timezone: "Europe/Moscow",
      interfaces: { account_linking: {}, screen: {} },
    },
    session: {
      session_id: "sim-session",
      message_id: 1,
      skill_id: SKILL_ID,
      application: { application_id: "app-1" },
      user:
        sessionToken === undefined
          ? { user_id: "yandex-user-sim" }
          : { user_id: "yandex-user-sim", access_token: sessionToken },
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

async function turn(
  payload: Record<string, unknown>,
  authToken?: string,
): Promise<ReturnType<typeof aliceResponseSchema.parse>> {
  const started = performance.now();
  const res = await app.inject({
    method: "POST",
    url: "/alice/webhook",
    payload,
    headers: authToken === undefined ? {} : { authorization: `Bearer ${authToken}` },
  });
  const elapsed = performance.now() - started;
  expect(elapsed).toBeLessThan(TURN_BUDGET_MS);
  expect(res.statusCode).toBe(200);
  const json = aliceResponseSchema.parse(res.json());
  if (json.response) {
    expect(json.response.text.length).toBeLessThanOrEqual(ALICE_MAX_TEXT_LENGTH);
    expect(json.response.tts?.length ?? 0).toBeLessThanOrEqual(ALICE_MAX_TEXT_LENGTH);
    expect(json.response.end_session).toBe(false);
  }
  return json;
}

beforeAll(async () => {
  const sqlite = createSqlite(":memory:");
  db = createDb(sqlite);
  runMigrations(db);
  app = buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", ALICE_SKILL_ID: SKILL_ID }), {
    db,
  });
  await app.ready();

  userId = createId();
  db.insert(users)
    .values({
      id: userId,
      email: "alice-sim@example.com",
      passwordHash: hashSync("pw", 10),
      role: "user",
    })
    .run();
  createList(db, userId, "Покупки");
  token = issueTokenPair(db, { userId, clientId: "alice" }).accessToken;
});

describe("T53 simulator pass (DoD flow)", () => {
  it("link → welcome → add → list → buy → unbuy, then revoke → relink", async () => {
    // 1. Unlinked private intent → link card alone, pending request saved.
    const gated = await turn(buildPayload({ command: "что купить" }));
    expect(gated.start_account_linking).toEqual({});
    expect(gated).not.toHaveProperty("response");
    const pending = gated.session_state?.[ALICE_PENDING_COMMAND_KEY];
    expect(pending).toBe("что купить");

    // 2. New session while unlinked → welcome text, no link card.
    const welcome = await turn(buildPayload({ sessionNew: true, command: "" }));
    expect(welcome.response?.text).toContain("Привет");

    // 3. Post-link event replays the saved request (list is empty).
    const replay = await turn(
      buildPayload({
        requestType: "AccountLinkingCompleteEvent",
        command: "",
        sessionState: { [ALICE_PENDING_COMMAND_KEY]: pending },
        sessionToken: token,
      }),
    );
    expect(replay).not.toHaveProperty("start_account_linking");
    expect(replay.response?.text).toBeDefined();

    // 4. Add → list hears it back → buy → unbuy.
    const added = await turn(buildPayload({ command: "добавь молоко" }), token);
    expect(added.response?.text).toContain("молоко");

    const listed = await turn(buildPayload({ command: "что купить" }), token);
    expect(listed.response?.text).toContain("молоко");

    const bought = await turn(buildPayload({ command: "купили молоко" }), token);
    expect(bought.response?.text).toContain("молоко");

    const unbought = await turn(buildPayload({ command: "верни молоко" }), token);
    expect(unbought.response?.text).toContain("молоко");

    const listedAgain = await turn(buildPayload({ command: "что купить" }), token);
    expect(listedAgain.response?.text).toContain("молоко");

    // 5. Manual revoke (access token expired) → link card again (relink prompt).
    db.update(oauthTokens)
      .set({ accessExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(oauthTokens.accessTokenHash, hashToken(token)))
      .run();
    const relink = await turn(buildPayload({ command: "что купить" }), token);
    expect(relink.start_account_linking).toEqual({});
    expect(relink).not.toHaveProperty("response");

    // 6. Fresh login after revoke → flow works again without repetition.
    const freshToken = issueTokenPair(db, { userId, clientId: "alice" }).accessToken;
    const afterRelink = await turn(buildPayload({ command: "что купить" }), freshToken);
    expect(afterRelink).not.toHaveProperty("start_account_linking");
    expect(afterRelink.response?.text).toContain("молоко");
  });
});
