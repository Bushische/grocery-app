import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { type Db, createDb, createSqlite } from "../db/client";
import { runMigrations } from "../db/migrate";
import { categories, groceryLists, itemBuyHistory, items, users } from "../db/schema";
import { deleteItem, getItemDetail, listBuyHistory, moveItem } from "./itemService";

function freshDb(): Db {
  const db = createDb(createSqlite(":memory:"));
  runMigrations(db);
  return db;
}

function seedList(db: Db): { listId: string; categoryId: string; itemId: string } {
  db.insert(users).values({ id: "u1", email: "u1@test.local", passwordHash: "x" }).run();
  db.insert(groceryLists).values({ id: "l1", title: "Weekly", ownerId: "u1" }).run();
  db.insert(categories)
    .values({ id: "c1", listId: "l1", title: "Other", color: "#6B7280", sortOrder: 0 })
    .run();
  const item = db
    .insert(items)
    .values({ id: "i1", listId: "l1", categoryId: "c1", title: "Milk", status: "TO_BUY" })
    .returning()
    .get();
  return { listId: "l1", categoryId: "c1", itemId: item.id };
}

let db: Db;
let itemId: string;

beforeEach(() => {
  db = freshDb();
  ({ itemId } = seedList(db));
});

describe("buy history service (T80)", () => {
  it("writes one row per move-to-BOUGHT and reads newest-first", () => {
    expect(listBuyHistory(db, itemId)).toEqual([]);
    moveItem(db, itemId, "BOUGHT", new Date("2026-09-20T10:00:00.000Z"));
    moveItem(db, itemId, "TO_BUY", new Date("2026-09-21T10:00:00.000Z"));
    moveItem(db, itemId, "BOUGHT", new Date("2026-09-25T10:00:00.000Z"));
    expect(listBuyHistory(db, itemId)).toEqual([
      "2026-09-25T10:00:00.000Z",
      "2026-09-20T10:00:00.000Z",
    ]);
    expect(getItemDetail(db, itemId).buyHistory).toEqual([
      "2026-09-25T10:00:00.000Z",
      "2026-09-20T10:00:00.000Z",
    ]);
  });

  it("prunes to the last 5 per item", () => {
    for (let day = 1; day <= 8; day += 1) {
      moveItem(
        db,
        itemId,
        "BOUGHT",
        new Date(`2026-09-${String(day).padStart(2, "0")}T10:00:00.000Z`),
      );
      if (day < 8) {
        moveItem(
          db,
          itemId,
          "TO_BUY",
          new Date(`2026-09-${String(day).padStart(2, "0")}T12:00:00.000Z`),
        );
      }
    }
    expect(listBuyHistory(db, itemId)).toEqual([
      "2026-09-08T10:00:00.000Z",
      "2026-09-07T10:00:00.000Z",
      "2026-09-06T10:00:00.000Z",
      "2026-09-05T10:00:00.000Z",
      "2026-09-04T10:00:00.000Z",
    ]);
  });

  it("writes nothing on move-to-TO_BUY", () => {
    moveItem(db, itemId, "BOUGHT", new Date("2026-09-20T10:00:00.000Z"));
    moveItem(db, itemId, "TO_BUY", new Date("2026-09-21T10:00:00.000Z"));
    expect(listBuyHistory(db, itemId)).toHaveLength(1);
  });

  it("cascades on item delete", () => {
    moveItem(db, itemId, "BOUGHT", new Date("2026-09-20T10:00:00.000Z"));
    expect(db.select().from(itemBuyHistory).all()).toHaveLength(1);
    deleteItem(db, itemId);
    expect(
      db.select().from(itemBuyHistory).where(eq(itemBuyHistory.itemId, itemId)).all(),
    ).toHaveLength(0);
  });
});
