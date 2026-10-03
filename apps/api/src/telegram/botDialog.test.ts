import { createId } from "@paralleldrive/cuid2";
import { beforeAll, describe, expect, it } from "vitest";
import { type Db, createDb, createSqlite } from "../db/client";
import { runMigrations } from "../db/migrate";
import { users } from "../db/schema";
import { addListMember, createList } from "../services/listService";
import { handleTelegramChat, parseTelegramIntent, resolveTelegramList } from "./botDialog";

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

function answerText(userId: string, command: string, isPrivate = true): string | undefined {
  const answer = handleTelegramChat(db, userId, command, isPrivate);
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

describe("handleTelegramChat grocery intents (T63)", () => {
  it("adds (EN+RU), lists with cap, buys, unbuys on the bound list", () => {
    expect(answerText(soloUser, "buy apples")).toBe('Added "apples" to "Home".');
    expect(answerText(soloUser, "buy apples")).toBe('"apples" is already on "Home".');
    expect(answerText(soloUser, "что купить")).toBe("«Home»: apples.");
    expect(answerText(soloUser, "bought apples")).toBe('Marked "apples" as bought.');
    expect(answerText(soloUser, "верни apples")).toBe("Вернул «apples» в покупки.");
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
