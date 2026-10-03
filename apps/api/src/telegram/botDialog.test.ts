import { createId } from "@paralleldrive/cuid2";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { type Db, createDb, createSqlite } from "../db/client";
import { runMigrations } from "../db/migrate";
import { groceryLists, users } from "../db/schema";
import { addListMember, createList } from "../services/listService";
import {
  type TelegramDialogDeps,
  handleTelegramChat,
  parseTelegramIntent,
  resolveTelegramList,
  splitItems,
} from "./botDialog";
import type { ActionExtractor } from "./extract";

let db: Db;
let soloUser: string;
let multiUser: string;
let emptyUser: string;
let viewerUser: string;
let soloListId: string;

function createUser(email: string): string {
  const id = createId();
  db.insert(users).values({ id, email, passwordHash: "dummy", role: "user" }).run();
  return id;
}

async function answerText(
  userId: string,
  command: string,
  isPrivate = true,
  quoted = "",
  deps: TelegramDialogDeps = {},
  chatId?: string,
): Promise<string | undefined> {
  const answer = await handleTelegramChat(
    db,
    userId,
    chatId ?? `chat:${userId}`,
    command,
    isPrivate,
    quoted,
    deps,
  );
  return answer.silent ? undefined : answer.text;
}

beforeAll(() => {
  const sqlite = createSqlite(":memory:");
  db = createDb(sqlite);
  runMigrations(db);
  soloUser = createUser("tg-solo@example.com");
  multiUser = createUser("tg-multi@example.com");
  emptyUser = createUser("tg-empty@example.com");
  viewerUser = createUser("tg-viewer@example.com");
  soloListId = createList(db, soloUser, "Home").id;
  createList(db, multiUser, "First");
  createList(db, multiUser, "Second");
  addListMember(db, soloListId, "tg-viewer@example.com", "VIEWER");
});

describe("parseTelegramIntent (T63 — EN verbs onto Alice NLU)", () => {
  it("maps buy/add to add, keeping quantities", async () => {
    expect(parseTelegramIntent("buy apples")).toEqual({ kind: "add", name: "apples" });
    expect(parseTelegramIntent("add 2 milk")).toEqual({ kind: "add", name: "milk", qtyText: "2" });
    expect(parseTelegramIntent("please buy bread please")).toEqual({ kind: "add", name: "bread" });
  });

  it("maps bought/done to buy and unbuy/return to unbuy", async () => {
    expect(parseTelegramIntent("bought apples")).toEqual({ kind: "buy", name: "apples" });
    expect(parseTelegramIntent("done milk")).toEqual({ kind: "buy", name: "milk" });
    expect(parseTelegramIntent("unbuy apples")).toEqual({ kind: "unbuy", name: "apples" });
    expect(parseTelegramIntent("milk back to list")).toEqual({ kind: "unbuy", name: "milk" });
  });

  it("recognizes English list commands and keeps Russian parsing intact", async () => {
    expect(parseTelegramIntent("what to buy")).toEqual({ kind: "list" });
    expect(parseTelegramIntent("show list")).toEqual({ kind: "list" });
    expect(parseTelegramIntent("купи молоко")).toEqual({ kind: "add", name: "молоко" });
    expect(parseTelegramIntent("что купить")).toEqual({ kind: "list" });
    expect(parseTelegramIntent("blabla").kind).toBe("unknown");
  });
});

describe("resolveTelegramList (T63)", () => {
  it("auto-uses the single writable list", async () => {
    const resolution = resolveTelegramList(db, soloUser, "chat:t63-single", "buy apples");
    expect(resolution).toEqual({
      kind: "resolved",
      listId: soloListId,
      title: "Home",
      rest: "buy apples",
      via: "single",
    });
  });

  it("reports no_lists without writable lists", async () => {
    expect(resolveTelegramList(db, emptyUser, "chat:t63-empty", "buy apples").kind).toBe(
      "no_lists",
    );
  });

  it("asks with names for several lists, routing …в/in <List> suffixes", async () => {
    const asked = resolveTelegramList(db, multiUser, "chat:t63-ask", "buy milk");
    expect(asked.kind).toBe("need_choice");
    const routed = resolveTelegramList(db, multiUser, "chat:t63-ask", "buy milk in Second");
    expect(routed).toMatchObject({ kind: "resolved", title: "Second", rest: "buy milk" });
    const routedRu = resolveTelegramList(db, multiUser, "chat:t63-ask", "купи молоко в First");
    expect(routedRu).toMatchObject({ kind: "resolved", title: "First" });
  });
});

describe("splitItems (T65)", () => {
  it("splits lines, semicolons, commas, and and/и", async () => {
    expect(splitItems("milk\nbread")).toEqual(["milk", "bread"]);
    expect(splitItems("milk, bread;butter")).toEqual(["milk", "bread", "butter"]);
    expect(splitItems("milk and bread")).toEqual(["milk", "bread"]);
    expect(splitItems("молоко и хлеб")).toEqual(["молоко", "хлеб"]);
    expect(splitItems("- milk\n• bread")).toEqual(["milk", "bread"]);
    expect(splitItems("  ")).toEqual([]);
  });

  it("caps at MAX_CHAT_ITEMS", async () => {
    const many = Array.from({ length: 30 }, (_, index) => `item${index}`).join(",");
    expect(splitItems(many)).toHaveLength(20);
  });
});

describe("handleTelegramChat multi-add (T65)", () => {
  it("adds several products with one summary reply", async () => {
    expect(await answerText(soloUser, "buy cheese, butter and 2 yogurt")).toBe(
      'Added "cheese", "butter", "yogurt" to "Home".',
    );
  });

  it("treats a bare multi-line list as products (reply-/buy shape)", async () => {
    expect(await answerText(soloUser, "kefir\nryazhenka")).toBe(
      'Added "kefir", "ryazhenka" to "Home".',
    );
  });

  it("notes already-listed items instead of duplicating silently", async () => {
    expect(await answerText(soloUser, "buy kefir, milk")).toContain("already on");
  });

  it("keeps single-item replies in the singular form", async () => {
    expect(await answerText(soloUser, "buy solitary-pear")).toBe(
      'Added "solitary-pear" to "Home".',
    );
  });

  it("enforces EDITOR+ on multi-add for VIEWERs", async () => {
    expect((await answerText(viewerUser, "milk, bread")) ?? "").toContain("editor");
  });
});

describe("handleTelegramChat quoted replies (T65 scenarios 2–3)", () => {
  it("adds a single quoted product on a bare command", async () => {
    expect(await answerText(soloUser, "", true, "plums")).toBe('Added "plums" to "Home".');
  });

  it("routes a list-hint command with quoted products by suffix", async () => {
    expect(await answerText(multiUser, "in Second", true, "kiwi")).toBe(
      'Added "kiwi" to "Second".',
    );
  });

  it("parses quoted intents, not just bare names", async () => {
    expect(await answerText(soloUser, "", true, "bought plums")).toBe('Marked "plums" as bought.');
  });

  it("prefers command products over the quote when both exist", async () => {
    expect(await answerText(soloUser, "buy pears", true, "plums")).toBe('Added "pears" to "Home".');
  });

  it("stays silent on empty quotes in groups", async () => {
    expect(await answerText(soloUser, "", false, "")).toBeUndefined();
  });
});

describe("handleTelegramChat JEV wiring (T66)", () => {
  const jevAdd: ActionExtractor = {
    extractAction: async () => ({ action: "add", confidence: 0.9 }),
  };
  const jevList: ActionExtractor = {
    extractAction: async () => ({ action: "list", confidence: 0.8 }),
  };
  const jevUnsure: ActionExtractor = {
    extractAction: async () => ({ action: "add", confidence: 0.2 }),
  };
  const jevDown: ActionExtractor = {
    extractAction: async () => ({ action: "unknown", confidence: 0 }),
  };

  it("applies a confident JEV verdict on deterministic-unknown text", async () => {
    const fresh = createUser("tg-jev@example.com");
    createList(db, fresh, "JEV");
    await expect(
      answerText(fresh, "something for pancakes", true, "", { extractor: jevAdd }),
    ).resolves.toBe('Added "something for pancakes" to "JEV".');
  });

  it("clarifies below the threshold and when JEV is unsure or down", async () => {
    const fresh = createUser("tg-jev2@example.com");
    createList(db, fresh, "JEV2");
    await expect(
      answerText(fresh, "something for pancakes", true, "", { extractor: jevUnsure }),
    ).resolves.toContain("Try");
    await expect(
      answerText(fresh, "something for pancakes", true, "", { extractor: jevDown }),
    ).resolves.toContain("Try");
    await expect(
      answerText(fresh, "something for pancakes", true, "", {
        extractor: jevList,
        confidenceThreshold: 0.95,
      }),
    ).resolves.toContain("Try");
  });

  it("routes a confident JEV list verdict without products", async () => {
    const fresh = createUser("tg-jev3@example.com");
    createList(db, fresh, "JEV3");
    await expect(
      answerText(fresh, "well hello there", true, "", { extractor: jevList }),
    ).resolves.toBe('"JEV3" has nothing to buy yet.');
  });

  it("never calls the extractor on deterministic hits (zero external calls)", async () => {
    let calls = 0;
    const counting = {
      extractAction: async () => {
        calls += 1;
        return { action: "unknown" as const, confidence: 0 };
      },
    };
    const fresh = createUser("tg-jev4@example.com");
    createList(db, fresh, "JEV4");
    await expect(answerText(fresh, "buy milk", true, "", { extractor: counting })).resolves.toBe(
      'Added "milk" to "JEV4".',
    );
    expect(calls).toBe(0);
  });
});

describe("handleTelegramChat grocery intents (T63)", () => {
  it("adds (EN+RU), lists with cap, buys, unbuys on the bound list", async () => {
    // Isolated list: T65 tests share soloUser's "Home" and would overflow the cap.
    const fresh = createUser("tg-t63@example.com");
    createList(db, fresh, "T63");
    expect(await answerText(fresh, "buy apples")).toBe('Added "apples" to "T63".');
    expect(await answerText(fresh, "buy apples")).toBe('"apples" is already on "T63".');
    expect(await answerText(fresh, "что купить")).toBe("«T63»: apples.");
    expect(await answerText(fresh, "bought apples")).toBe('Marked "apples" as bought.');
    expect(await answerText(fresh, "верни apples")).toBe("Вернул «apples» в покупки.");
  });

  it("clarifies unknown item names instead of moving the wrong item", async () => {
    expect(await answerText(soloUser, "bought dragonfruit")).toContain("dragonfruit");
  });

  it("helps on unknown private text and stays silent in groups", async () => {
    expect((await answerText(soloUser, "blabla")) ?? "").toContain("buy milk");
    expect(await answerText(soloUser, "blabla", false)).toBeUndefined();
  });

  it("asks multi-list users to specify, then routes by suffix", async () => {
    // Fresh chat: a suffix stored earlier on the user's default chat must not leak in.
    const chat = `chat:t63-remember-${createId()}`;
    expect((await answerText(multiUser, "buy milk", true, "", {}, chat)) ?? "").toContain("First");
    expect(await answerText(multiUser, "buy milk in Second", true, "", {}, chat)).toBe(
      'Added "milk" to "Second".',
    );
  });

  it("reports empty state with no lists and rights for VIEWERs", async () => {
    expect((await answerText(emptyUser, "buy milk")) ?? "").toContain("No lists");
    expect((await answerText(viewerUser, "buy milk")) ?? "").toContain("editor");
    expect((await answerText(viewerUser, "what to buy")) ?? "").toContain("Home");
  });
});

describe("chat default + commands (T69)", () => {
  it("asks once, then remembers the chat default", async () => {
    const chat = `chat:t69-once-${createId()}`;
    expect((await answerText(multiUser, "buy quince", true, "", {}, chat)) ?? "").toContain("/use");
    expect(await answerText(multiUser, "buy quince in Second", true, "", {}, chat)).toBe(
      'Added "quince" to "Second".',
    );
    expect(await answerText(multiUser, "buy feijoa", true, "", {}, chat)).toBe(
      'Added "feijoa" to "Second".',
    );
  });

  it("keeps defaults independent per chat", async () => {
    const chatA = `chat:t69-a-${createId()}`;
    const chatB = `chat:t69-b-${createId()}`;
    expect(await answerText(multiUser, "use First", true, "", {}, chatA)).toContain("First");
    expect(await answerText(multiUser, "buy tea", true, "", {}, chatA)).toBe(
      'Added "tea" to "First".',
    );
    expect((await answerText(multiUser, "buy coffee", true, "", {}, chatB)) ?? "").toContain(
      "/use",
    );
  });

  it("/lists marks the current default and /use switches it", async () => {
    const chat = `chat:t69-lists-${createId()}`;
    const before = (await answerText(multiUser, "lists", true, "", {}, chat)) ?? "";
    expect(before).toContain("First");
    expect(before).toContain("Second");
    expect(before).not.toContain("●");
    expect(await answerText(multiUser, "use Second", true, "", {}, chat)).toContain("Second");
    const after = (await answerText(multiUser, "списки", true, "", {}, chat)) ?? "";
    expect(after).toContain("● «Second»");
  });

  it("/use rejects unknown names without storing anything", async () => {
    const chat = `chat:t69-miss-${createId()}`;
    expect((await answerText(multiUser, "use Atlantis", true, "", {}, chat)) ?? "").toContain(
      "Atlantis",
    );
    expect(
      (await answerText(multiUser, "buy t69-coffee-beans", true, "", {}, chat)) ?? "",
    ).toContain("/use_list");
  });

  it("shows a locked default the caller cannot access", async () => {
    const chat = `chat:t69-locked-${createId()}`;
    const owner = createUser("tg-t69-owner@example.com");
    const stranger = createUser("tg-t69-stranger@example.com");
    createList(db, owner, "Shared");
    createList(db, stranger, "Mine");
    expect(await answerText(owner, "buy nails in Shared", true, "", {}, chat)).toContain("Shared");
    const asked = (await answerText(stranger, "buy bolts", true, "", {}, chat)) ?? "";
    expect(asked).toContain("🔒");
    expect(asked).toContain("Shared");
    expect(asked).toContain("Mine");
    const lists = (await answerText(stranger, "lists", true, "", {}, chat)) ?? "";
    expect(lists).toContain("🔒");
    expect(lists).toContain("Shared");
  });

  it("helps on /help in private and stays silent in groups", async () => {
    expect((await answerText(soloUser, "help")) ?? "").toContain("/grocery_lists");
    expect((await answerText(soloUser, "/start")) ?? "").toContain("/grocery_lists");
    expect(await answerText(soloUser, "help", false)).toBeUndefined();
  });

  it("answers the BotFather names grocery_lists + use_list (T73)", async () => {
    const chat = `chat:t73-${createId()}`;
    const lists = (await answerText(multiUser, "grocery_lists", true, "", {}, chat)) ?? "";
    expect(lists).toContain("First");
    expect(lists).toContain("/use_list");
    expect(await answerText(multiUser, "use_list First", true, "", {}, chat)).toContain("First");
    expect(await answerText(multiUser, "buy t73-fig", true, "", {}, chat)).toBe(
      'Added "t73-fig" to "First".',
    );
  });
});

describe("inline choices (T70)", () => {
  it("attaches tap choices to need_choice and /lists, none to plain replies", async () => {
    const chat = `chat:t70-${createId()}`;
    const asked = await handleTelegramChat(db, multiUser, chat, "buy t70-lychee", true);
    expect(asked.silent).toBe(false);
    expect(asked.choices?.map((c) => c.title).sort()).toEqual(["First", "Second"]);
    const lists = await handleTelegramChat(db, multiUser, chat, "lists", true);
    expect(lists.choices?.map((c) => c.title).sort()).toEqual(["First", "Second"]);
    const added = await handleTelegramChat(
      db,
      soloUser,
      `chat:t70-solo-${createId()}`,
      "buy t70-papaya",
      true,
    );
    expect(added.text).toBe('Added "t70-papaya" to "Home".');
    expect(added.choices).toBeUndefined();
  });
});

describe("stale chat defaults (T69)", () => {
  it("stale defaults fall through without errors", async () => {
    const chat = `chat:t69-stale-${createId()}`;
    const user = createUser("tg-t69-stale@example.com");
    const doomed = createList(db, user, "Doomed").id;
    createList(db, user, "Kept");
    expect(await answerText(user, "use Doomed", true, "", {}, chat)).toContain("Doomed");
    db.delete(groceryLists).where(eq(groceryLists.id, doomed)).run();
    expect(await answerText(user, "buy t69-pear", true, "", {}, chat)).toBe(
      'Added "t69-pear" to "Kept".',
    );
  });
});
