import type Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seedDatabase } from "../../scripts/seed";
import { createDb, createSqlite } from "./client";
import { runMigrations } from "./migrate";
import { categories, groceryLists, items, listMembers, priceObservations, users } from "./schema";

function freshDb() {
  const sqlite = createSqlite(":memory:");
  const db = createDb(sqlite);
  runMigrations(db);
  return { sqlite, db };
}

const tableNames = (sqlite: Database.Database): string[] =>
  (
    sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
      name: string;
    }[]
  ).map((row) => row.name);

describe("migrations", () => {
  it("apply cleanly on a fresh database and create all tables from docs/DATA_MODEL.md", () => {
    const { sqlite } = freshDb();
    const names = tableNames(sqlite);
    for (const table of [
      "users",
      "refresh_tokens",
      "api_tokens",
      "lists",
      "list_members",
      "categories",
      "items",
      "price_observations",
    ]) {
      expect(names).toContain(table);
    }
  });

  it("are idempotent (re-running applies no changes)", () => {
    const { sqlite, db } = freshDb();
    runMigrations(db);
    expect(tableNames(sqlite).filter((n) => n === "users")).toHaveLength(1);
  });

  it("reject FK violations", () => {
    const { db } = freshDb();

    const user = db
      .insert(users)
      .values({ id: "u1", email: "u1@test.local", passwordHash: "x" })
      .returning()
      .get();
    const list = db
      .insert(groceryLists)
      .values({ id: "l1", title: "Weekly", ownerId: user.id })
      .returning()
      .get();
    const category = db
      .insert(categories)
      .values({ id: "c1", listId: list.id, title: "Other", color: "#6B7280" })
      .returning()
      .get();

    expect(() =>
      db.insert(groceryLists).values({ id: "l2", title: "Orphan", ownerId: "missing-user" }).run(),
    ).toThrowError(/FOREIGN KEY/);
    expect(() =>
      db
        .insert(categories)
        .values({ id: "c2", listId: "missing-list", title: "X", color: "#000000" })
        .run(),
    ).toThrowError(/FOREIGN KEY/);
    expect(() =>
      db
        .insert(items)
        .values({ id: "i2", listId: list.id, categoryId: "missing-category", title: "Orphan item" })
        .run(),
    ).toThrowError(/FOREIGN KEY/);
    expect(() =>
      db
        .insert(listMembers)
        .values({ listId: list.id, userId: "missing-user", role: "EDITOR" })
        .run(),
    ).toThrowError(/FOREIGN KEY/);
    expect(() =>
      db
        .insert(priceObservations)
        .values({ id: "p1", itemId: "missing-item", priceCents: 100, shop: "Lidl" })
        .run(),
    ).toThrowError(/FOREIGN KEY/);

    // The valid chain inserts fine.
    expect(() =>
      db
        .insert(items)
        .values({ id: "i1", listId: list.id, categoryId: category.id, title: "Milk" })
        .run(),
    ).not.toThrow();
  });

  it("cascade deletes and restrict deletes per docs/DATA_MODEL.md", () => {
    const { db } = freshDb();
    const user = db
      .insert(users)
      .values({ id: "u1", email: "u1@test.local", passwordHash: "x" })
      .returning()
      .get();
    const list = db
      .insert(groceryLists)
      .values({ id: "l1", title: "Weekly", ownerId: user.id })
      .returning()
      .get();
    const category = db
      .insert(categories)
      .values({ id: "c1", listId: list.id, title: "Other", color: "#6B7280" })
      .returning()
      .get();
    const item = db
      .insert(items)
      .values({ id: "i1", listId: list.id, categoryId: category.id, title: "Milk" })
      .returning()
      .get();
    db.insert(priceObservations)
      .values({ id: "p1", itemId: item.id, priceCents: 119, shop: "Lidl" })
      .run();

    // Deleting a category that still has items is rejected (ON DELETE RESTRICT).
    expect(() => db.delete(categories).where(eq(categories.id, category.id)).run()).toThrowError(
      /FOREIGN KEY/,
    );

    // Deleting the list cascades to categories, items, and price observations.
    db.delete(groceryLists).where(eq(groceryLists.id, list.id)).run();
    expect(db.select().from(categories).all()).toHaveLength(0);
    expect(db.select().from(items).all()).toHaveLength(0);
    expect(db.select().from(priceObservations).all()).toHaveLength(0);
  });
});

describe("seed", () => {
  it("creates 2 users, 1 list, 3 categories, 3 items, 4 price observations", () => {
    const { db } = freshDb();
    const result = seedDatabase(db);
    expect(result.counts).toEqual({
      users: 2,
      lists: 1,
      categories: 3,
      items: 3,
      priceObservations: 4,
    });
    const admin = db.select().from(users).where(eq(users.email, result.adminEmail)).get();
    expect(admin?.role).toBe("admin");
    const member = db.select().from(users).where(eq(users.email, result.memberEmail)).get();
    expect(member?.role).toBe("user");
    const other = db.select().from(categories).where(eq(categories.title, "Other")).get();
    expect(other?.color).toBe("#6B7280");
    const statuses = db
      .select()
      .from(items)
      .all()
      .map((i) => i.status)
      .sort();
    expect(statuses).toEqual(["BOUGHT", "TO_BUY", "TO_BUY"]);
  });

  it("is idempotent: re-running changes nothing", () => {
    const { db } = freshDb();
    const first = seedDatabase(db);
    const second = seedDatabase(db);
    expect(second.counts).toEqual(first.counts);
    expect(second.listId).toBe(first.listId);
    expect(db.select().from(listMembers).all()).toHaveLength(2);
    expect(
      db
        .select()
        .from(users)
        .all()
        .map((u) => u.email)
        .sort(),
    ).toEqual([first.adminEmail, first.memberEmail].sort());
  });
});
