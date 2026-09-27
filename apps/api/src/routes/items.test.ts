import type { ListRole, SmartAddResponse } from "@grocery/shared";
import { createId } from "@paralleldrive/cuid2";
import { hashSync } from "bcryptjs";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { loadConfig } from "../config";
import { type Db, createDb, createSqlite } from "../db/client";
import { runMigrations } from "../db/migrate";
import { categories, items, priceObservations, users } from "../db/schema";

const OWNER = { email: "owner@example.com", password: "owner-password" };
const EDITOR = { email: "editor@example.com", password: "editor-password" };
const VIEWER = { email: "viewer@example.com", password: "viewer-password" };
const OUTSIDER = { email: "outsider@example.com", password: "outsider-password" };

const ALL_USERS = [OWNER, EDITOR, VIEWER, OUTSIDER];

type ItemRow = typeof items.$inferSelect;

let app: FastifyInstance;
let db: Db;
let ownerToken: string;
let editorToken: string;
let viewerToken: string;
let outsiderToken: string;
let familyListId: string;
let otherCategoryId: string;

const DAY_MS = 86_400_000;

function buildTestApp(): { app: FastifyInstance; db: Db } {
  const sqlite = createSqlite(":memory:");
  const database = createDb(sqlite);
  runMigrations(database);
  const built = buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent" }), { db: database });
  return { app: built, db: database };
}

function bearer(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

async function accessToken(email: string, password: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email, password },
  });
  expect(res.statusCode).toBe(200);
  return res.json().accessToken;
}

async function createList(token: string, title: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/lists",
    headers: bearer(token),
    payload: { title },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

function addMember(token: string, listId: string, email: string, role: ListRole) {
  return app.inject({
    method: "POST",
    url: `/lists/${listId}/members`,
    headers: bearer(token),
    payload: { email, role },
  });
}

/** Scratch list owned by OWNER with the full role matrix. */
async function createScratchList(title: string): Promise<string> {
  const listId = await createList(ownerToken, title);
  expect((await addMember(ownerToken, listId, EDITOR.email, "EDITOR")).statusCode).toBe(201);
  expect((await addMember(ownerToken, listId, VIEWER.email, "VIEWER")).statusCode).toBe(201);
  return listId;
}

function otherCategoryOf(listId: string): typeof categories.$inferSelect {
  const row = db
    .select()
    .from(categories)
    .where(eq(categories.listId, listId))
    .all()
    .find((category) => category.title === "Other");
  if (!row) throw new Error(`Other category of list ${listId} missing`);
  return row;
}

/** Inserts an item directly, bypassing the API, for deterministic fixtures. */
function seedItem(listId: string, categoryId: string, values: Partial<typeof items.$inferInsert>) {
  return db
    .insert(items)
    .values({ id: createId(), listId, categoryId, title: "Untitled", ...values })
    .returning()
    .get();
}

function itemById(itemId: string): ItemRow | undefined {
  return db.select().from(items).where(eq(items.id, itemId)).get();
}

function observationsOf(itemId: string): (typeof priceObservations.$inferSelect)[] {
  return db.select().from(priceObservations).where(eq(priceObservations.itemId, itemId)).all();
}

async function smartAdd(listId: string, text: string, token = editorToken) {
  return app.inject({
    method: "POST",
    url: `/lists/${listId}/items/smart-add`,
    headers: bearer(token),
    payload: { text },
  });
}

beforeAll(async () => {
  ({ app, db } = buildTestApp());
  db.insert(users)
    .values(
      ALL_USERS.map((user) => ({
        id: createId(),
        email: user.email,
        passwordHash: hashSync(user.password, 10),
        role: "user" as const,
      })),
    )
    .run();
  ownerToken = await accessToken(OWNER.email, OWNER.password);
  editorToken = await accessToken(EDITOR.email, EDITOR.password);
  viewerToken = await accessToken(VIEWER.email, VIEWER.password);
  outsiderToken = await accessToken(OUTSIDER.email, OUTSIDER.password);

  familyListId = await createScratchList("Family");
  otherCategoryId = otherCategoryOf(familyListId).id;

  // Deterministic ordering fixture: sortOrder 0 twice with different addedAt
  // (addedAt breaks the tie), plus a bought item with its own sortOrder space.
  const now = Date.now();
  seedItem(familyListId, otherCategoryId, {
    title: "Milk",
    status: "TO_BUY",
    sortOrder: 0,
    addedAt: new Date(now - 3 * DAY_MS),
  });
  seedItem(familyListId, otherCategoryId, {
    title: "Late Add",
    status: "TO_BUY",
    sortOrder: 0,
    addedAt: new Date(now),
  });
  seedItem(familyListId, otherCategoryId, {
    title: "Butter",
    status: "BOUGHT",
    sortOrder: 1,
    addedAt: new Date(now - DAY_MS),
    boughtAt: new Date(now),
  });
});

describe("GET /lists/:id/items", () => {
  it("orders by sortOrder then addedAt and computes daysInList", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/lists/${familyListId}/items`,
      headers: bearer(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(["items"]);
    const list = body.items as Array<Record<string, unknown>>;
    // Same sortOrder → older addedAt first; the bought item keeps its slot.
    expect(list.map((item) => item.title)).toEqual(["Milk", "Late Add", "Butter"]);
    expect(list.map((item) => item.daysInList)).toEqual([3, 0, 1]);
    for (const item of list) {
      expect(item.category).toEqual({
        id: otherCategoryId,
        title: "Other",
        color: "#6B7280",
      });
      expect(item.imageFilename).toBeNull();
      expect(String(item.addedAt)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    }
    expect(list[0]).toMatchObject({ status: "TO_BUY", qtyText: null });
  });

  it("filters by status=to_buy", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/lists/${familyListId}/items?status=to_buy`,
      headers: bearer(viewerToken),
    });
    expect(res.statusCode).toBe(200);
    const list = res.json().items as Array<{ status: string; title: string }>;
    expect(list.map((item) => item.title)).toEqual(["Milk", "Late Add"]);
    expect(list.every((item) => item.status === "TO_BUY")).toBe(true);
  });

  it("filters by status=bought", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/lists/${familyListId}/items?status=bought`,
      headers: bearer(viewerToken),
    });
    expect(res.statusCode).toBe(200);
    const list = res.json().items as Array<{ status: string; title: string }>;
    expect(list.map((item) => item.title)).toEqual(["Butter"]);
    expect(list.every((item) => item.status === "BOUGHT")).toBe(true);
  });

  it("rejects an invalid status filter with 400", async () => {
    for (const status of ["BOUGHT", "all", ""]) {
      const res = await app.inject({
        method: "GET",
        url: `/lists/${familyListId}/items?status=${encodeURIComponent(status)}`,
        headers: bearer(ownerToken),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("rejects a non-member with 403", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/lists/${familyListId}/items`,
      headers: bearer(outsiderToken),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  it("rejects an unknown list with 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/lists/does-not-exist/items",
      headers: bearer(ownerToken),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("rejects a missing token with 401", async () => {
    const res = await app.inject({ method: "GET", url: `/lists/${familyListId}/items` });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });
});

describe("POST /lists/:id/items", () => {
  it("creates a TO_BUY item in the Other category appended to the end (EDITOR allowed)", async () => {
    const listId = await createScratchList("Create Defaults");
    const first = await app.inject({
      method: "POST",
      url: `/lists/${listId}/items`,
      headers: bearer(editorToken),
      payload: { title: " Bananas " },
    });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({
      title: "Bananas",
      status: "TO_BUY",
      sortOrder: 0,
      qtyText: null,
      imageFilename: null,
      category: { title: "Other", color: "#6B7280" },
    });
    const second = await app.inject({
      method: "POST",
      url: `/lists/${listId}/items`,
      headers: bearer(ownerToken),
      payload: { title: "Apples" },
    });
    expect(second.statusCode).toBe(201);
    expect(second.json().sortOrder).toBe(1);
    expect(itemById(first.json().id as string)?.usageCount).toBe(0);
  });

  it("appends after the TO_BUY section's max sortOrder, ignoring BOUGHT rows", async () => {
    const listId = await createScratchList("Create Append");
    const other = otherCategoryOf(listId);
    seedItem(listId, other.id, { title: "Old", status: "BOUGHT", sortOrder: 9 });
    seedItem(listId, other.id, { title: "Current", status: "TO_BUY", sortOrder: 2 });
    const res = await app.inject({
      method: "POST",
      url: `/lists/${listId}/items`,
      headers: bearer(ownerToken),
      payload: { title: "New" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().sortOrder).toBe(3);
  });

  it("honors categoryId and qtyText (EDITOR allowed)", async () => {
    const listId = await createScratchList("Create Explicit");
    const created = await app.inject({
      method: "POST",
      url: `/lists/${listId}/categories`,
      headers: bearer(ownerToken),
      payload: { title: "Dairy", color: "#3B82F6" },
    });
    const categoryId = created.json().id as string;
    const res = await app.inject({
      method: "POST",
      url: `/lists/${listId}/items`,
      headers: bearer(editorToken),
      payload: { title: "Milk", categoryId, qtyText: " 2x " },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      title: "Milk",
      qtyText: "2x",
      category: { id: categoryId, title: "Dairy", color: "#3B82F6" },
    });
  });

  it("rejects a categoryId from another list or unknown with 400", async () => {
    const listId = await createScratchList("Create Foreign Cat");
    const foreignList = await createList(ownerToken, "Foreign");
    const foreignOther = otherCategoryOf(foreignList);
    for (const categoryId of [foreignOther.id, "does-not-exist"]) {
      const res = await app.inject({
        method: "POST",
        url: `/lists/${listId}/items`,
        headers: bearer(ownerToken),
        payload: { title: "Milk", categoryId },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("rejects VIEWER and non-members with 403", async () => {
    const listId = await createScratchList("Create Roles");
    for (const token of [viewerToken, outsiderToken]) {
      const res = await app.inject({
        method: "POST",
        url: `/lists/${listId}/items`,
        headers: bearer(token),
        payload: { title: "Milk" },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("FORBIDDEN");
    }
    expect(db.select().from(items).where(eq(items.listId, listId)).all()).toHaveLength(0);
  });

  it("validates the payload with 400", async () => {
    for (const payload of [{}, { title: "" }, { title: "   " }, { title: "Milk", qtyText: "  " }]) {
      const res = await app.inject({
        method: "POST",
        url: `/lists/${familyListId}/items`,
        headers: bearer(ownerToken),
        payload,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("rejects an unknown list with 404 and a missing token with 401", async () => {
    const missing = await app.inject({
      method: "POST",
      url: "/lists/does-not-exist/items",
      headers: bearer(ownerToken),
      payload: { title: "Milk" },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("NOT_FOUND");

    const unauthenticated = await app.inject({
      method: "POST",
      url: `/lists/${familyListId}/items`,
      payload: { title: "Milk" },
    });
    expect(unauthenticated.statusCode).toBe(401);
    expect(unauthenticated.json().error.code).toBe("UNAUTHORIZED");
  });
});

describe("POST /lists/:id/items/smart-add", () => {
  it("matches an existing TO_BUY item exactly (case-insensitive) and leaves it unchanged", async () => {
    const listId = await createScratchList("Smart Exact");
    const other = otherCategoryOf(listId);
    const seeded = seedItem(listId, other.id, {
      title: "Milk",
      status: "TO_BUY",
      sortOrder: 0,
      usageCount: 3,
      addedAt: new Date(Date.now() - 2 * DAY_MS),
    });
    const before = itemById(seeded.id);
    const res = await smartAdd(listId, "MILK");
    expect(res.statusCode).toBe(200);
    const body = res.json() as SmartAddResponse;
    expect(body).toMatchObject({ created: false, matchedBy: "exact" });
    expect(body.item).toMatchObject({ id: seeded.id, title: "Milk", status: "TO_BUY" });
    expect(body.item.addedAt).toBe(before?.addedAt.toISOString());
    const after = itemById(seeded.id);
    expect(after?.usageCount).toBe(3);
    expect(after?.sortOrder).toBe(0);
  });

  it("re-activates an exact-matched BOUGHT item at the end of TO_BUY", async () => {
    const listId = await createScratchList("Smart Reactivate");
    const other = otherCategoryOf(listId);
    const boughtAt = new Date(Date.now() - DAY_MS);
    const coffee = seedItem(listId, other.id, {
      title: "Coffee",
      status: "TO_BUY",
      sortOrder: 0,
    });
    const bought = seedItem(listId, other.id, {
      title: "Butter",
      status: "BOUGHT",
      sortOrder: 0,
      usageCount: 2,
      addedAt: new Date(Date.now() - 5 * DAY_MS),
      boughtAt,
    });
    const before = new Date();
    const res = await smartAdd(listId, "butter");
    expect(res.statusCode).toBe(200);
    const body = res.json() as SmartAddResponse;
    expect(body).toMatchObject({ created: false, matchedBy: "exact" });
    expect(body.item).toMatchObject({ id: bought.id, status: "TO_BUY", daysInList: 0 });
    const after = itemById(bought.id);
    expect(after?.status).toBe("TO_BUY");
    expect(after?.boughtAt).toBeNull();
    expect(after?.usageCount).toBe(3);
    expect(after?.sortOrder).toBe(1);
    expect(after?.addedAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    // It left the bought section and joined the to_buy section.
    const toBuy = await app.inject({
      method: "GET",
      url: `/lists/${listId}/items?status=to_buy`,
      headers: bearer(ownerToken),
    });
    expect((toBuy.json().items as Array<{ id: string }>).map((item) => item.id)).toEqual([
      coffee.id,
      bought.id,
    ]);
    const boughtList = await app.inject({
      method: "GET",
      url: `/lists/${listId}/items?status=bought`,
      headers: bearer(ownerToken),
    });
    expect(boughtList.json().items).toEqual([]);
  });

  it("matches by substring and ranks by usageCount DESC", async () => {
    const listId = await createScratchList("Smart Substring Rank");
    const other = otherCategoryOf(listId);
    seedItem(listId, other.id, { title: "Milk Chocolate", usageCount: 5, sortOrder: 0 });
    seedItem(listId, other.id, { title: "Hot Milk", usageCount: 1, sortOrder: 1 });
    seedItem(listId, other.id, { title: "Cold Milk", usageCount: 0, sortOrder: 2 });
    const res = await smartAdd(listId, "milk");
    expect(res.statusCode).toBe(200);
    const body = res.json() as SmartAddResponse;
    expect(body.matchedBy).toBe("substring");
    expect(body.created).toBe(false);
    expect(body.item.title).toBe("Milk Chocolate");
  });

  it("breaks usageCount ties by the smaller title-length diff (both ways)", async () => {
    const listId = await createScratchList("Smart Substring Diff");
    const other = otherCategoryOf(listId);
    seedItem(listId, other.id, { title: "Milk", usageCount: 0, sortOrder: 0 });
    seedItem(listId, other.id, { title: "Cold Milk", usageCount: 0, sortOrder: 1 });
    // Both titles are substrings of the query; "Cold Milk" (diff 5) beats "Milk" (diff 9).
    const res = await smartAdd(listId, "very cold milk");
    expect(res.statusCode).toBe(200);
    const body = res.json() as SmartAddResponse;
    expect(body.matchedBy).toBe("substring");
    expect(body.item.title).toBe("Cold Milk");
  });

  it("falls back to a fuzzy match (Dice >= 0.6)", async () => {
    const listId = await createScratchList("Smart Fuzzy");
    const other = otherCategoryOf(listId);
    seedItem(listId, other.id, { title: "Semi-skimmed Milk", sortOrder: 0 });
    // Not exact ("semi skimmed milk" != "Semi-skimmed Milk") and not a
    // substring in either direction (hyphen vs space) — pure Dice.
    const res = await smartAdd(listId, "semi skimmed milk");
    expect(res.statusCode).toBe(200);
    const body = res.json() as SmartAddResponse;
    expect(body.matchedBy).toBe("fuzzy");
    expect(body.created).toBe(false);
    expect(body.item.title).toBe("Semi-skimmed Milk");
  });

  it("creates in the Other category when nothing matches (201)", async () => {
    const listId = await createScratchList("Smart Create");
    const res = await smartAdd(listId, "Completely new thing");
    expect(res.statusCode).toBe(201);
    const body = res.json() as SmartAddResponse;
    expect(body).toMatchObject({ created: true, matchedBy: "created" });
    expect(body.item).toMatchObject({
      title: "Completely new thing",
      status: "TO_BUY",
      category: { title: "Other", color: "#6B7280" },
    });
    // A second attempt matches the freshly created item exactly.
    const again = await smartAdd(listId, "completely new thing");
    expect(again.statusCode).toBe(200);
    expect((again.json() as SmartAddResponse).matchedBy).toBe("exact");
  });

  it("re-activates a substring-matched BOUGHT item", async () => {
    const listId = await createScratchList("Smart Bought Substring");
    const other = otherCategoryOf(listId);
    seedItem(listId, other.id, {
      title: "Wholegrain Bread",
      status: "BOUGHT",
      usageCount: 1,
      boughtAt: new Date(),
    });
    const res = await smartAdd(listId, "wholegrain");
    expect(res.statusCode).toBe(200);
    const body = res.json() as SmartAddResponse;
    expect(body.matchedBy).toBe("substring");
    expect(body.item.status).toBe("TO_BUY");
    const after = itemById(body.item.id);
    expect(after?.status).toBe("TO_BUY");
    expect(after?.boughtAt).toBeNull();
    expect(after?.usageCount).toBe(2);
  });

  it("rejects VIEWER and non-members with 403", async () => {
    const listId = await createScratchList("Smart Roles");
    for (const token of [viewerToken, outsiderToken]) {
      const res = await smartAdd(listId, "Milk", token);
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("FORBIDDEN");
    }
    expect(db.select().from(items).where(eq(items.listId, listId)).all()).toHaveLength(0);
  });

  it("rejects an unknown list with 404 and an empty text with 400", async () => {
    const unknown = await smartAdd("does-not-exist", "Milk", ownerToken);
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.code).toBe("NOT_FOUND");

    const empty = await smartAdd(familyListId, "   ");
    expect(empty.statusCode).toBe(400);
    expect(empty.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a missing token with 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/lists/${familyListId}/items/smart-add`,
      payload: { text: "Milk" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });
});

describe("GET /items/:id", () => {
  it("returns the item with its price history newest first as decimal numbers", async () => {
    const listId = await createScratchList("Detail");
    const other = otherCategoryOf(listId);
    const now = Date.now();
    const item = seedItem(listId, other.id, {
      title: "Milk",
      qtyText: "1L",
      sortOrder: 0,
      addedAt: new Date(now - 2 * DAY_MS),
    });
    db.insert(priceObservations)
      .values([
        {
          id: createId(),
          itemId: item.id,
          priceCents: 119,
          shop: "Lidl",
          observedAt: new Date(now - 2 * DAY_MS),
        },
        {
          id: createId(),
          itemId: item.id,
          priceCents: 129,
          shop: "Rewe",
          observedAt: new Date(now - DAY_MS),
        },
      ])
      .run();

    const res = await app.inject({
      method: "GET",
      url: `/items/${item.id}`,
      headers: bearer(viewerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual([
      "addedAt",
      "category",
      "daysInList",
      "id",
      "imageFilename",
      "prices",
      "qtyText",
      "sortOrder",
      "status",
      "title",
    ]);
    expect(body).toMatchObject({
      id: item.id,
      title: "Milk",
      daysInList: 2,
      category: { title: "Other", color: "#6B7280" },
    });
    expect(body.prices).toEqual([
      {
        price: 1.29,
        shop: "Rewe",
        observedAt: new Date(Math.floor((now - DAY_MS) / 1000) * 1000).toISOString(),
      },
      {
        price: 1.19,
        shop: "Lidl",
        observedAt: new Date(Math.floor((now - 2 * DAY_MS) / 1000) * 1000).toISOString(),
      },
    ]);
  });

  it("returns an empty prices array when no observations exist", async () => {
    const listId = await createScratchList("Detail Empty");
    const item = seedItem(listId, otherCategoryOf(listId).id, { title: "Bread" });
    const res = await app.inject({
      method: "GET",
      url: `/items/${item.id}`,
      headers: bearer(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().prices).toEqual([]);
  });

  it("rejects a non-member with 403 and an unknown item with 404", async () => {
    const listId = await createScratchList("Detail Roles");
    const item = seedItem(listId, otherCategoryOf(listId).id, { title: "Bread" });
    const forbidden = await app.inject({
      method: "GET",
      url: `/items/${item.id}`,
      headers: bearer(outsiderToken),
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().error.code).toBe("FORBIDDEN");

    const missing = await app.inject({
      method: "GET",
      url: "/items/does-not-exist",
      headers: bearer(ownerToken),
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("NOT_FOUND");
  });

  it("rejects a missing token with 401", async () => {
    const res = await app.inject({ method: "GET", url: "/items/does-not-exist" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });
});

describe("PATCH /items/:id", () => {
  it("updates title, qtyText, and categoryId (EDITOR allowed)", async () => {
    const listId = await createScratchList("Patch Item");
    const other = otherCategoryOf(listId);
    const item = seedItem(listId, other.id, { title: "Milk", sortOrder: 0 });
    const created = await app.inject({
      method: "POST",
      url: `/lists/${listId}/categories`,
      headers: bearer(ownerToken),
      payload: { title: "Dairy", color: "#3B82F6" },
    });
    const dairyId = created.json().id as string;

    const res = await app.inject({
      method: "PATCH",
      url: `/items/${item.id}`,
      headers: bearer(editorToken),
      payload: { title: "Fresh Milk", categoryId: created.json().id, qtyText: " 1L " },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: item.id,
      title: "Fresh Milk",
      qtyText: "1L",
      category: { id: dairyId, title: "Dairy" },
    });
    expect(itemById(item.id)).toMatchObject({
      title: "Fresh Milk",
      categoryId: created.json().id,
      qtyText: "1L",
    });
  });

  it("clears qtyText with null and treats an empty patch as a no-op", async () => {
    const listId = await createScratchList("Patch Clear");
    const item = seedItem(listId, otherCategoryOf(listId).id, {
      title: "Milk",
      qtyText: "2x",
    });
    const cleared = await app.inject({
      method: "PATCH",
      url: `/items/${item.id}`,
      headers: bearer(ownerToken),
      payload: { qtyText: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().qtyText).toBeNull();

    const noop = await app.inject({
      method: "PATCH",
      url: `/items/${item.id}`,
      headers: bearer(ownerToken),
      payload: {},
    });
    expect(noop.statusCode).toBe(200);
    expect(noop.json().title).toBe("Milk");
  });

  it("rejects a categoryId from another list with 400", async () => {
    const listId = await createScratchList("Patch Foreign");
    const item = seedItem(listId, otherCategoryOf(listId).id, { title: "Milk" });
    const foreign = await createList(ownerToken, "Foreign List");
    const foreignCategoryId = otherCategoryOf(foreign).id;
    const res = await app.inject({
      method: "PATCH",
      url: `/items/${item.id}`,
      headers: bearer(ownerToken),
      payload: { categoryId: foreignCategoryId },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    expect(itemById(item.id)?.categoryId).toBe(otherCategoryOf(listId).id);
  });

  it("rejects VIEWER and non-members with 403", async () => {
    const listId = await createScratchList("Patch Roles");
    const item = seedItem(listId, otherCategoryOf(listId).id, { title: "Milk" });
    for (const token of [viewerToken, outsiderToken]) {
      const res = await app.inject({
        method: "PATCH",
        url: `/items/${item.id}`,
        headers: bearer(token),
        payload: { title: "Hijacked" },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("FORBIDDEN");
    }
    expect(itemById(item.id)?.title).toBe("Milk");
  });

  it("validates an empty title with 400 and rejects unknown items with 404", async () => {
    const item = seedItem(familyListId, otherCategoryId, { title: "Milk", sortOrder: 99 });
    const invalid = await app.inject({
      method: "PATCH",
      url: `/items/${item.id}`,
      headers: bearer(ownerToken),
      payload: { title: "  " },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe("VALIDATION_ERROR");

    const missing = await app.inject({
      method: "PATCH",
      url: "/items/does-not-exist",
      headers: bearer(ownerToken),
      payload: { title: "X" },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("NOT_FOUND");
  });

  it("rejects a missing token with 401", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/items/does-not-exist",
      payload: { title: "X" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });
});

describe("DELETE /items/:id", () => {
  it("deletes the item and cascades its price observations (EDITOR allowed)", async () => {
    const listId = await createScratchList("Delete Item");
    const other = otherCategoryOf(listId);
    const item = seedItem(listId, other.id, { title: "Milk", status: "TO_BUY", sortOrder: 0 });
    db.insert(priceObservations)
      .values([
        {
          id: createId(),
          itemId: item.id,
          priceCents: 199,
          shop: "Lidl",
          observedAt: new Date(),
        },
      ])
      .run();
    expect(observationsOf(item.id)).toHaveLength(1);

    const res = await app.inject({
      method: "DELETE",
      url: `/items/${item.id}`,
      headers: bearer(editorToken),
    });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe("");
    expect(itemById(item.id)).toBeUndefined();
    expect(observationsOf(item.id)).toHaveLength(0);
  });

  it("rejects VIEWER and non-members with 403", async () => {
    const listId = await createScratchList("Delete Item Roles");
    const item = seedItem(listId, otherCategoryOf(listId).id, { title: "Milk" });
    for (const token of [viewerToken, outsiderToken]) {
      const res = await app.inject({
        method: "DELETE",
        url: `/items/${item.id}`,
        headers: bearer(token),
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("FORBIDDEN");
    }
    expect(itemById(item.id)).toBeDefined();
  });

  it("rejects an unknown item with 404 and a missing token with 401", async () => {
    const missing = await app.inject({
      method: "DELETE",
      url: "/items/does-not-exist",
      headers: bearer(ownerToken),
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("NOT_FOUND");

    const unauthenticated = await app.inject({ method: "DELETE", url: "/items/does-not-exist" });
    expect(unauthenticated.statusCode).toBe(401);
    expect(unauthenticated.json().error.code).toBe("UNAUTHORIZED");
  });
});
