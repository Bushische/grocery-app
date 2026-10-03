import { createId } from "@paralleldrive/cuid2";
import { beforeAll, describe, expect, it } from "vitest";
import { type Db, createDb, createSqlite } from "../db/client";
import { runMigrations } from "../db/migrate";
import { telegramLinks, users } from "../db/schema";
import { FastifyHttpError } from "../errors";
import {
  getTelegramLinkByTelegramId,
  getTelegramLinkByUserId,
  linkTelegramAccount,
  unlinkTelegramAccount,
} from "./service";

let db: Db;
let userA: string;
let userB: string;

function createUser(email: string): string {
  const id = createId();
  db.insert(users).values({ id, email, passwordHash: "dummy-hash", role: "user" }).run();
  return id;
}

function linkCount(): number {
  return db.select().from(telegramLinks).all().length;
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
  userA = createUser("tg-a@example.com");
  userB = createUser("tg-b@example.com");
});

describe("telegram_links (T58 — re-assign by default)", () => {
  it("links a Telegram id and resolves it in both directions", () => {
    const row = linkTelegramAccount(db, userA, "279058397");
    expect(row.userId).toBe(userA);
    expect(row.telegramId).toBe("279058397");
    expect(getTelegramLinkByTelegramId(db, "279058397")?.userId).toBe(userA);
    expect(getTelegramLinkByUserId(db, userA)?.telegramId).toBe("279058397");
  });

  it("re-linking the same Telegram id to another user MOVES the link (no duplicate)", () => {
    linkTelegramAccount(db, userB, "279058397");
    expect(getTelegramLinkByTelegramId(db, "279058397")?.userId).toBe(userB);
    // The previous user simply becomes unlinked — their next session gets 404.
    expect(getTelegramLinkByUserId(db, userA)).toBeNull();
    expect(linkCount()).toBe(1);
  });

  it("re-linking a user to a new Telegram id replaces their old one", () => {
    linkTelegramAccount(db, userB, "555");
    expect(getTelegramLinkByUserId(db, userB)?.telegramId).toBe("555");
    expect(getTelegramLinkByTelegramId(db, "279058397")).toBeNull();
    expect(linkCount()).toBe(1);
  });

  it("unlink removes the caller's link and is idempotent", () => {
    unlinkTelegramAccount(db, userB);
    expect(getTelegramLinkByUserId(db, userB)).toBeNull();
    expect(getTelegramLinkByTelegramId(db, "555")).toBeNull();
    unlinkTelegramAccount(db, userB);
  });

  it("rejects unknown users and empty ids", () => {
    expectHttpError(() => linkTelegramAccount(db, "no-such-user", "777"), 404, "NOT_FOUND");
    expectHttpError(() => linkTelegramAccount(db, userA, ""), 400, "VALIDATION_ERROR");
  });
});
