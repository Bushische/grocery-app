import { createId } from "@paralleldrive/cuid2";
import { beforeAll, describe, expect, it } from "vitest";
import { type Db, createDb, createSqlite } from "../db/client";
import { runMigrations } from "../db/migrate";
import { users } from "../db/schema";
import { addListMember, createList } from "../services/listService";
import { handleTelegramChat, parseTelegramIntent, resolveTelegramList, splitItems } from "./botDialog";

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

function answerText(userId: string, command: string, isPrivate = true, quoted = ""): string | undefined {
  const answer = handleTelegramChat(db, userId, command, isPrivate, quoted);
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
  it("maps buy/add to add, keeping quantities", () => {
    expect(parseTelegramIntent("buy apples")).toEqual({ kind: "add", name: "apples" });
    expect(parseTelegramIntent("add 2 milk")).toEqual({ kind: "add", name: "milk", qtyText: "2" });
    expect(parseTelegramIntent("please buy bread please")).toEqual({ kind: "add", name: "bread" });
  });

  it("maps bought/done to buy and unbuy/return to unbuy", () => {
    expect(parseTelegramIntent("bought apples")).toEqual({ kind: "buy", name: "apples" });
    expect(parseTelegramIntent("done milk")).toEqual({ kind: "buy", name: "milk" });
    expect(parseTelegramIntent("unbuy apples")).toEqual({ kind: "unbuy", name: "apples" });
    expect(parseTelegramIntent("milk back to list")).toEqual({ kind: "unbuy", name: "milk" });
  });

  it("recognizes English list commands and keeps Russian parsing intact", () => {
    expect(parseTelegramIntent("what to buy")).toEqual({ kind: "list" });
    expect(parseTelegramIntent("show list")).toEqual({ kind: "list" });
    expect(parseTelegramIntent("купи молоко")).toEqual({ kind: "add", name: "молоко" });
    expect(parseTelegramIntent("что купить")).toEqual({ kind: "list" });
    expect(parseTelegramIntent("blabla").kind).toBe("unknown");
  });
});

describe("resolveTelegramList (T63)", () => {
  it("auto-uses the single writable list", () => {
    const resolution = resolveTelegramList(db, soloUser, "buy apples");
    expect(resolution).toEqual({
      kind: "resolved",
      listId: soloListId,
      title: "Home",
      rest: "buy apples",
    });
  });

  it("reports no_lists without writable lists", () => {
    expect(resolveTelegramList(db, emptyUser, "buy apples").kind).toBe("no_lists");
  });

  it("asks with names for several lists, routing …в/in <List> suffixes", () => {
    const asked = resolveTelegramList(db, multiUser, "buy milk");
    expect(asked.kind).toBe("need_choice");
    const routed = resolveTelegramList(db, multiUser, "buy milk in Second");
    expect(routed).toMatchObject({ kind: "resolved", title: "Second", rest: "buy milk" });
    const routedRu = resolveTelegramList(db, multiUser, "купи молоко в First");
    expect(routedRu).toMatchObject({ kind: "resolved", title: "First" });
  });
});

describe("splitItems (T65)", () => {
  it("splits lines, semicolons, commas, and and/и", () => {
    expect(splitItems("milk\nbread")).toEqual(["milk", "bread"]);
    expect(splitItems("milk, bread;butter")).toEqual(["milk", "bread", "butter"]);
    expect(splitItems("milk and bread")).toEqual(["milk", "bread"]);
    expect(splitItems("молоко и хлеб")).toEqual(["молоко", "хлеб"]);
    expect(splitItems("- milk\n• bread")).toEqual(["milk", "bread"]);
    expect(splitItems("  ")).toEqual([]);
  });

  it("caps at MAX_CHAT_ITEMS", () => {
    const many = Array.from({ length: 30 }, (_, index) => `item${index}`).join(",");
    expect(splitItems(many)).toHaveLength(20);
  });
});

describe("handleTelegramChat multi-add (T65)", () => {
  it("adds several products with one summary reply", () => {
    expect(answerText(soloUser, "buy cheese, butter and 2 yogurt")).toBe(
      'Added "cheese", "butter", "yogurt" to "Home".',
    );
  });

  it("treats a bare multi-line list as products (reply-/buy shape)", () => {
    expect(answerText(soloUser, "kefir\nryazhenka")).toBe('Added "kefir", "ryazhenka" to "Home".');
  });

  it("notes already-listed items instead of duplicating silently", () => {
    expect(answerText(soloUser, "buy kefir, milk")).toContain("already on");
  });

  it("keeps single-item replies in the singular form", () => {
    expect(answerText(soloUser, "buy solitary-pear")).toBe('Added "solitary-pear" to "Home".');
  });

  it("enforces EDITOR+ on multi-add for VIEWERs", () => {
    expect(answerText(viewerUser, "milk, bread") ?? "").toContain("editor");
  });
});

describe("handleTelegramChat quoted replies (T65 scenarios 2–3)", () => {
  it("adds a single quoted product on a bare command", () => {
    expect(answerText(soloUser, "", true, "plums")).toBe('Added "plums" to "Home".');
  });

  it("routes a list-hint command with quoted products by suffix", () => {
    expect(answerText(multiUser, "in Second", true, "kiwi")).toBe('Added "kiwi" to "Second".');
  });

  it("parses quoted intents, not just bare names", () => {
    expect(answerText(soloUser, "", true, "bought plums")).toBe('Marked "plums" as bought.');
  });

  it("prefers command products over the quote when both exist", () => {
    expect(answerText(soloUser, "buy pears", true, "plums")).toBe('Added "pears" to "Home".');
  });

  it("stays silent on empty quotes in groups", () => {
    expect(answerText(soloUser, "", false, "")).toBeUndefined();
  });
});

describe("handleTelegramChat grocery intents (T63)", () => {
  it("adds (EN+RU), lists with cap, buys, unbuys on the bound list", () => {
    // Isolated list: T65 tests share soloUser's "Home" and would overflow the cap.
    const fresh = createUser("tg-t63@example.com");
    createList(db, fresh, "T63");
    expect(answerText(fresh, "buy apples")).toBe('Added "apples" to "T63".');
    expect(answerText(fresh, "buy apples")).toBe('"apples" is already on "T63".');
    expect(answerText(fresh, "что купить")).toBe("«T63»: apples.");
    expect(answerText(fresh, "bought apples")).toBe('Marked "apples" as bought.');
    expect(answerText(fresh, "верни apples")).toBe("Вернул «apples» в покупки.");
  });

  it("clarifies unknown item names instead of moving the wrong item", () => {
    expect(answerText(soloUser, "bought dragonfruit")).toContain("dragonfruit");
  });

  it("helps on unknown private text and stays silent in groups", () => {
    expect(answerText(soloUser, "blabla") ?? "").toContain("buy milk");
    expect(answerText(soloUser, "blabla", false)).toBeUndefined();
  });

  it("asks multi-list users to specify, then routes by suffix", () => {
    expect(answerText(multiUser, "buy milk") ?? "").toContain("First");
    expect(answerText(multiUser, "buy milk in Second")).toBe('Added "milk" to "Second".');
  });

  it("reports empty state with no lists and rights for VIEWERs", () => {
    expect(answerText(emptyUser, "buy milk") ?? "").toContain("No lists");
    expect(answerText(viewerUser, "buy milk") ?? "").toContain("editor");
    expect(answerText(viewerUser, "what to buy") ?? "").toContain("Home");
  });
});
