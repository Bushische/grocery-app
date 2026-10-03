import { createId } from "@paralleldrive/cuid2";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { type Db, createDb, createSqlite } from "../db/client";
import { runMigrations } from "../db/migrate";
import { groceryLists, telegramChatDefaults, users } from "../db/schema";
import { FastifyHttpError } from "../errors";
import { clearChatDefault, getChatDefault, setChatDefault } from "./chatDefaults";

let db: Db;
let userA: string;
let userB: string;
let listHome: string;
let listDacha: string;

function createUser(email: string): string {
  const id = createId();
  db.insert(users).values({ id, email, passwordHash: "dummy-hash", role: "user" }).run();
  return id;
}

function createList(title: string, ownerId: string): string {
  const id = createId();
  db.insert(groceryLists).values({ id, title, ownerId }).run();
  return id;
}

function expectHttpError(fn: () => unknown, status: number, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(FastifyHttpError);
    expect((error as FastifyHttpError).status).toBe(status);
    expect((error as FastifyHttpError).code).toBe(code);
    return;
  }
  throw new Error(`expected FastifyHttpError ${status} ${code}`);
}

beforeAll(() => {
  const sqlite = createSqlite(":memory:");
  db = createDb(sqlite);
  runMigrations(db);
  userA = createUser("chatdef-a@example.com");
  userB = createUser("chatdef-b@example.com");
  listHome = createList("Home", userA);
  listDacha = createList("Dacha", userA);
});

describe("telegram_chat_defaults (T68 — one shared default per chat)", () => {
  it("returns null when nothing is stored", () => {
    expect(getChatDefault(db, "424242")).toBeNull();
  });

  it("stores the default and reads it back with the setter", () => {
    const row = setChatDefault(db, "424242", listHome, userA);
    expect(row.chatId).toBe("424242");
    expect(row.listId).toBe(listHome);
    expect(row.setByUserId).toBe(userA);
    expect(getChatDefault(db, "424242")?.listId).toBe(listHome);
  });

  it("last writer wins and the setter is replaced", () => {
    setChatDefault(db, "424242", listDacha, userB);
    const row = getChatDefault(db, "424242");
    expect(row?.listId).toBe(listDacha);
    expect(row?.setByUserId).toBe(userB);
    expect(db.select().from(telegramChatDefaults).all()).toHaveLength(1);
  });

  it("different chats keep independent defaults", () => {
    setChatDefault(db, "-999", listHome, userA);
    expect(getChatDefault(db, "-999")?.listId).toBe(listHome);
    expect(getChatDefault(db, "424242")?.listId).toBe(listDacha);
  });

  it("a deleted list reads as unset and cleans the row", () => {
    db.delete(groceryLists).where(eq(groceryLists.id, listDacha)).run();
    expect(getChatDefault(db, "424242")).toBeNull();
    expect(
      db
        .select()
        .from(telegramChatDefaults)
        .all()
        .find((r) => r.chatId === "424242"),
    ).toBeUndefined();
  });

  it("clear is idempotent", () => {
    clearChatDefault(db, "-999");
    expect(getChatDefault(db, "-999")).toBeNull();
    clearChatDefault(db, "-999");
  });

  it("rejects unknown lists and users", () => {
    expectHttpError(() => setChatDefault(db, "1", "no-such-list", userA), 404, "NOT_FOUND");
    expectHttpError(() => setChatDefault(db, "1", listHome, "no-such-user"), 404, "NOT_FOUND");
  });
});
