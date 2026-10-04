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
    expect(parseTelegramIntent("need to buy")).toEqual({ kind: "list" });
    expect(parseTelegramIntent("need to buy: milk, bread")).toEqual({
      kind: "add",
      name: "milk, bread",
    });
    expect(parseTelegramIntent("нужно купить молоко, хлеб")).toEqual({
      kind: "add",
      name: "молоко, хлеб",
    });
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
      'Added to "Home":\n• "cheese"\n• "butter"\n• "yogurt"',
    );
  });

  it("treats a bare multi-line list as products (reply-/buy shape)", async () => {
    expect(await answerText(soloUser, "kefir\nryazhenka")).toBe(
      'Added to "Home":\n• "kefir"\n• "ryazhenka"',
    );
  });

  it("notes already-listed items instead of duplicating silently", async () => {
    expect(await answerText(soloUser, "buy kefir, milk")).toContain("Already on the list:");
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
    expect(await answerText(fresh, "что купить")).toBe("«T63»:\n• apples");
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

describe("multi-add exact-only dedup (T78)", () => {
  it("adds item1, item2, item3 as three rows instead of fuzzy-merging", async () => {
    const chat = `chat:t78-${createId()}`;
    const user = createUser("tg-t78@example.com");
    createList(db, user, "T78");
    const reply = (await answerText(user, "item1, item2, item3", true, "", {}, chat)) ?? "";
    expect(reply).toContain('"item1"');
    expect(reply).toContain('"item2"');
    expect(reply).toContain('"item3"');
  });

  it("still dedups exact repeats and keeps single-add smart behavior", async () => {
    const chat = `chat:t78-dup-${createId()}`;
    const user = createUser("tg-t78-dup@example.com");
    createList(db, user, "T78D");
    expect(await answerText(user, "buy apple", true, "", {}, chat)).toContain("apple");
    // Near-miss coexists in multi-add …
    expect(await answerText(user, "apple, apples", true, "", {}, chat)).toContain("apples");
    // … while single-add keeps the smart already-on keep (exact and fuzzy).
    expect(await answerText(user, "buy apples", true, "", {}, chat)).toContain("already on");
    expect(await answerText(user, "buy aple", true, "", {}, chat)).toContain("already on");
  });

  it("need to buy: adds all fragments end to end (T81)", async () => {
    const chat = `chat:t81-${createId()}`;
    const user = createUser("tg-t81@example.com");
    createList(db, user, "T81");
    const reply =
      (await answerText(user, "need to buy: t81-fig1, t81-fig2", true, "", {}, chat)) ?? "";
    expect(reply).toContain("t81-fig1");
    expect(reply).toContain("t81-fig2");
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

describe("formatted list-family replies (T74)", () => {
  it("pins /grocery_lists bullets with ● default (EN+RU)", async () => {
    const chat = `chat:t74-lists-${createId()}`;
    const user = createUser("tg-t74-lists@example.com");
    createList(db, user, "First");
    createList(db, user, "Second");
    // Two lists created in the same ms tie on createdAt and fall back to
    // random-id order — accept either order, the bullet format is what's pinned.
    const before = (await answerText(user, "lists", true, "", {}, chat)) ?? "";
    expect([
      'Lists:\n• "First"\n• "Second"\nSwitch: /use_list <name>.',
      'Lists:\n• "Second"\n• "First"\nSwitch: /use_list <name>.',
    ]).toContain(before);
    expect(await answerText(user, "use_list Second", true, "", {}, chat)).toBe(
      'This chat now shops for:\n• ● "Second"',
    );
    const after = (await answerText(user, "lists", true, "", {}, chat)) ?? "";
    expect(after).toContain('• ● "Second"');
    expect(after).toContain("Bare commands");
    expect(after.split("\n")[0]).toBe("Lists:");
    const ru = (await answerText(user, "списки", true, "", {}, chat)) ?? "";
    expect(ru).toContain("• ● «Second»");
    expect(ru.split("\n")[0]).toBe("Списки:");
  });

  it("pins need-choice bullets with 🔒 line (EN+RU)", async () => {
    const chatEn = `chat:t74-need-${createId()}`;
    const user = createUser("tg-t74-need@example.com");
    createList(db, user, "First");
    createList(db, user, "Second");
    // Same-ms createdAt ties fall back to random-id order — accept either.
    expect([
      'You have several lists:\n• "First"\n• "Second"\nSpecify one, e.g. "buy milk in First" or "/use_list First".',
      'You have several lists:\n• "Second"\n• "First"\nSpecify one, e.g. "buy milk in Second" or "/use_list Second".',
    ]).toContain((await answerText(user, "buy milk", true, "", {}, chatEn)) ?? "");
    const chatRu = `chat:t74-need-ru-${createId()}`;
    expect([
      "У вас несколько списков:\n• «First»\n• «Second»\nУточните, например: «купи молоко в First» или «/use_list First».",
      "У вас несколько списков:\n• «Second»\n• «First»\nУточните, например: «купи молоко в Second» или «/use_list Second».",
    ]).toContain((await answerText(user, "купи молоко", true, "", {}, chatRu)) ?? "");
  });

  it("pins the locked 🔒 line on its own line", async () => {
    const chat = `chat:t74-locked-${createId()}`;
    const owner = createUser("tg-t74-owner@example.com");
    const stranger = createUser("tg-t74-stranger@example.com");
    createList(db, owner, "Shared");
    createList(db, stranger, "Mine");
    expect(await answerText(owner, "buy nails in Shared", true, "", {}, chat)).toContain("Shared");
    const asked = (await answerText(stranger, "buy bolts", true, "", {}, chat)) ?? "";
    expect(asked).toBe(
      'You have several lists:\n• "Mine"\nSpecify one, e.g. "buy milk in Mine" or "/use_list Mine".\n🔒 "Shared" is this chat\'s default but you have no access — ask the owner to share it.',
    );
    const lists = (await answerText(stranger, "lists", true, "", {}, chat)) ?? "";
    expect(lists).toBe(
      'Lists:\n• "Mine"\nSwitch: /use_list <name>.\n🔒 "Shared" is this chat\'s default but you have no access — ask the owner to share it.',
    );
  });

  it("pins /help bullets (EN+RU)", async () => {
    expect((await answerText(soloUser, "help")) ?? "").toBe(
      'Commands:\n• /grocery_lists — lists and this chat\'s default\n• /use_list <name> — set it\n• "buy milk" — add\n• "what to buy" — show\n• "bought milk" — mark bought\n• "unbuy milk" — return',
    );
    expect((await answerText(soloUser, "помощь")) ?? "").toBe(
      "Команды:\n• /grocery_lists — списки и текущий список чата\n• /use_list <название> — выбрать список чата\n• «купи молоко» — добавить\n• «что купить» — показать покупки\n• «купили молоко» — отметить купленным\n• «верни молоко» — вернуть в покупки",
    );
  });

  it("pins what-to-buy bullets with the more line (EN+RU)", async () => {
    const user = createUser("tg-t74-what@example.com");
    createList(db, user, "What");
    const chat = `chat:t74-what-${createId()}`;
    await answerText(user, "buy a1, a2, a3, a4, a5, a6, a7, a8", true, "", {}, chat);
    expect((await answerText(user, "what to buy", true, "", {}, chat)) ?? "").toBe(
      '"What":\n• a1\n• a2\n• a3\n• a4\n• a5\n• a6\n• a7\nand 1 more',
    );
    const ruUser = createUser("tg-t74-what-ru@example.com");
    createList(db, ruUser, "Что");
    const chatRu = `chat:t74-what-ru-${createId()}`;
    await answerText(ruUser, "купи м1, м2", true, "", {}, chatRu);
    expect((await answerText(ruUser, "что купить", true, "", {}, chatRu)) ?? "").toBe(
      "«Что»:\n• м1\n• м2",
    );
  });

  it("pins add-many bullets incl. kept notes (EN+RU)", async () => {
    const user = createUser("tg-t74-many@example.com");
    createList(db, user, "Many");
    const chat = `chat:t74-many-${createId()}`;
    expect(await answerText(user, "buy milk, bread", true, "", {}, chat)).toBe(
      'Added to "Many":\n• "milk"\n• "bread"',
    );
    expect(await answerText(user, "buy milk, cheese", true, "", {}, chat)).toBe(
      'Added to "Many":\n• "cheese"\nAlready on the list:\n• "milk"',
    );
    expect(await answerText(user, "buy milk, cheese", true, "", {}, chat)).toBe(
      'Already on "Many":\n• "milk"\n• "cheese"',
    );
    const ruUser = createUser("tg-t74-many-ru@example.com");
    createList(db, ruUser, "Много");
    const chatRu = `chat:t74-many-ru-${createId()}`;
    expect(await answerText(ruUser, "купи молоко, хлеб", true, "", {}, chatRu)).toBe(
      "Добавил в «Много»:\n• «молоко»\n• «хлеб»",
    );
  });

  it("pins /use_list confirms with ● bullets (EN+RU)", async () => {
    const chat = `chat:t74-use-${createId()}`;
    const user = createUser("tg-t74-use@example.com");
    createList(db, user, "First");
    expect(await answerText(user, "use_list First", true, "", {}, chat)).toBe(
      'This chat now shops for:\n• ● "First"',
    );
    const chatRu = `chat:t74-use-ru-${createId()}`;
    expect(await answerText(user, "выбери First", true, "", {}, chatRu)).toBe(
      "Теперь этот чат покупает в:\n• ● «First»",
    );
  });

  it("keeps grocery one-liners single-line", async () => {
    const user = createUser("tg-t74-one@example.com");
    createList(db, user, "One");
    const chat = `chat:t74-one-${createId()}`;
    const added = (await answerText(user, "buy solo-pear", true, "", {}, chat)) ?? "";
    expect(added).toBe('Added "solo-pear" to "One".');
    expect(added).not.toContain("\n");
    const bought = (await answerText(user, "bought solo-pear", true, "", {}, chat)) ?? "";
    expect(bought).toBe('Marked "solo-pear" as bought.');
    expect(bought).not.toContain("\n");
  });

  it("never exceeds Telegram's 4096-char limit", async () => {
    const user = createUser("tg-t74-cap@example.com");
    createList(db, user, "Cap");
    const chat = `chat:t74-cap-${createId()}`;
    const many = Array.from({ length: 20 }, (_, i) => `cap-item-${i}`).join(", ");
    const added = (await answerText(user, many, true, "", {}, chat)) ?? "";
    expect(added.length).toBeLessThan(4096);
    const listed = (await answerText(user, "what to buy", true, "", {}, chat)) ?? "";
    expect(listed.length).toBeLessThan(4096);
    const lists = (await answerText(user, "lists", true, "", {}, chat)) ?? "";
    expect(lists.length).toBeLessThan(4096);
  });
});
