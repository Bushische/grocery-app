import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ListRole, PriceObservation, PricesResponse } from "@grocery/shared";
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

let app: FastifyInstance;
let db: Db;
let ownerToken: string;
let editorToken: string;
let viewerToken: string;
let outsiderToken: string;
let listId: string;
let otherCategoryId: string;

/** Isolated uploads root so the suite never touches real data/. */
const uploadsDir = mkdtempSync(join(tmpdir(), "grocery-prices-"));

function buildTestApp(): { app: FastifyInstance; db: Db } {
  const sqlite = createSqlite(":memory:");
  const database = createDb(sqlite);
  runMigrations(database);
  const built = buildApp(
    loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", UPLOADS_PATH: uploadsDir }),
    { db: database },
  );
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

function addMember(listId: string, email: string, role: ListRole) {
  return app.inject({
    method: "POST",
    url: `/lists/${listId}/members`,
    headers: bearer(ownerToken),
    payload: { email, role },
  });
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

function seedItem(values: Partial<typeof items.$inferInsert>) {
  return db
    .insert(items)
    .values({ id: createId(), listId, categoryId: otherCategoryId, title: "Untitled", ...values })
    .returning()
    .get();
}

function observationsOf(itemId: string): (typeof priceObservations.$inferSelect)[] {
  return db.select().from(priceObservations).where(eq(priceObservations.itemId, itemId)).all();
}

function addPrice(itemId: string, payload: Record<string, unknown>, token = editorToken) {
  return app.inject({
    method: "POST",
    url: `/items/${itemId}/prices`,
    headers: bearer(token),
    payload,
  });
}

function getPrices(itemId: string, query = "", token = viewerToken) {
  return app.inject({
    method: "GET",
    url: `/items/${itemId}/prices${query}`,
    headers: bearer(token),
  });
}

/** ISO string of a fixed second-precision instant (stored as unixepoch seconds). */
function iso(day: number): string {
  return new Date(Date.UTC(2026, 8, day, 10, 0, 0)).toISOString();
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

  listId = await createList(ownerToken, "Prices");
  expect((await addMember(listId, EDITOR.email, "EDITOR")).statusCode).toBe(201);
  expect((await addMember(listId, VIEWER.email, "VIEWER")).statusCode).toBe(201);
  otherCategoryId = otherCategoryOf(listId).id;
});

describe("POST /items/:id/prices", () => {
  it("stores an observation and returns it as a decimal price (EDITOR allowed)", async () => {
    const item = seedItem({ title: "Milk" });
    const res = await addPrice(item.id, { price: 1.99, shop: "Lidl" }, ownerToken);
    expect(res.statusCode).toBe(201);
    const body = res.json() as PriceObservation;
    expect(body.price).toBe(1.99);
    expect(body.shop).toBe("Lidl");
    // Omitted observedAt defaults to server time.
    expect(Math.abs(Date.parse(body.observedAt) - Date.now())).toBeLessThan(5000);

    const stored = observationsOf(item.id);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ priceCents: 199, shop: "Lidl" });
  });

  it("round-trips an explicit observedAt and converts cents exactly", async () => {
    const item = seedItem({ title: "Bread" });
    const res = await addPrice(item.id, {
      price: 0.1,
      shop: " Rewe ",
      observedAt: "2026-09-20T10:30:00Z",
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      price: 0.1,
      shop: "Rewe",
      observedAt: "2026-09-20T10:30:00.000Z",
    });
    expect(observationsOf(item.id)[0]).toMatchObject({ priceCents: 10 });
  });

  it("rejects invalid prices, shops, and observedAt values with 400", async () => {
    const item = seedItem({ title: "Butter" });
    for (const payload of [
      { price: 0, shop: "Lidl" },
      { price: -1.5, shop: "Lidl" },
      { price: "1.99", shop: "Lidl" },
      { shop: "Lidl" },
      { price: 1.99, shop: "" },
      { price: 1.99, shop: "   " },
      { price: 1.99 },
      { price: 1.99, shop: "Lidl", observedAt: "yesterday" },
    ]) {
      const res = await addPrice(item.id, payload, ownerToken);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
    }
    expect(observationsOf(item.id)).toHaveLength(0);
  });

  it("rejects VIEWER and non-members with 403 and stores nothing", async () => {
    const item = seedItem({ title: "Cheese" });
    for (const token of [viewerToken, outsiderToken]) {
      const res = await addPrice(item.id, { price: 1, shop: "Lidl" }, token);
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("FORBIDDEN");
    }
    expect(observationsOf(item.id)).toHaveLength(0);
  });

  it("rejects unknown items with 404 and a missing token with 401", async () => {
    const missing = await addPrice("does-not-exist", { price: 1, shop: "Lidl" }, ownerToken);
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("NOT_FOUND");

    const unauthenticated = await app.inject({
      method: "POST",
      url: "/items/does-not-exist/prices",
      payload: { price: 1, shop: "Lidl" },
    });
    expect(unauthenticated.statusCode).toBe(401);
    expect(unauthenticated.json().error.code).toBe("UNAUTHORIZED");
  });
});

describe("GET /items/:id/prices", () => {
  it("returns the empty history of an item without observations", async () => {
    const item = seedItem({ title: "Salt" });
    const res = await getPrices(item.id, "", ownerToken);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ observations: [], nextCursor: null });
  });

  it("lists observations newest first and updates currentPrice on item reads", async () => {
    const item = seedItem({ title: "Milk" });
    // Older observation first, then the newer one — history must invert them.
    expect(
      (await addPrice(item.id, { price: 1.19, shop: "Lidl", observedAt: iso(20) })).statusCode,
    ).toBe(201);
    expect(
      (await addPrice(item.id, { price: 1.29, shop: "Rewe", observedAt: iso(25) })).statusCode,
    ).toBe(201);

    const history = await getPrices(item.id, "", ownerToken);
    expect(history.statusCode).toBe(200);
    expect(history.json()).toEqual({
      observations: [
        { price: 1.29, shop: "Rewe", observedAt: iso(25) },
        { price: 1.19, shop: "Lidl", observedAt: iso(20) },
      ],
      nextCursor: null,
    });

    const detail = await app.inject({
      method: "GET",
      url: `/items/${item.id}`,
      headers: bearer(viewerToken),
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().currentPrice).toEqual({ price: 1.29, shop: "Rewe", observedAt: iso(25) });
    expect(detail.json().prices).toEqual(history.json().observations);

    const list = await app.inject({
      method: "GET",
      url: `/lists/${listId}/items`,
      headers: bearer(viewerToken),
    });
    const row = (
      list.json().items as Array<{ id: string; currentPrice: PriceObservation | null }>
    ).find((entry) => entry.id === item.id);
    expect(row?.currentPrice).toEqual({ price: 1.29, shop: "Rewe", observedAt: iso(25) });
  });

  it("breaks observedAt ties by insertion order (later insert is current)", async () => {
    const item = seedItem({ title: "Tied" });
    expect(
      (await addPrice(item.id, { price: 1.0, shop: "First", observedAt: iso(15) })).statusCode,
    ).toBe(201);
    expect(
      (await addPrice(item.id, { price: 2.0, shop: "Second", observedAt: iso(15) })).statusCode,
    ).toBe(201);

    const history = await getPrices(item.id, "", ownerToken);
    expect((history.json() as PricesResponse).observations.map((o) => o.shop)).toEqual([
      "Second",
      "First",
    ]);

    const detail = await app.inject({
      method: "GET",
      url: `/items/${item.id}`,
      headers: bearer(viewerToken),
    });
    expect(detail.json().currentPrice).toMatchObject({ price: 2.0, shop: "Second" });
  });

  it("rejects VIEWER-adjacent access: non-member 403, missing token 401, unknown item 404", async () => {
    const item = seedItem({ title: "Tea" });
    const forbidden = await getPrices(item.id, "", outsiderToken);
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().error.code).toBe("FORBIDDEN");

    const unauthenticated = await app.inject({ method: "GET", url: `/items/${item.id}/prices` });
    expect(unauthenticated.statusCode).toBe(401);
    expect(unauthenticated.json().error.code).toBe("UNAUTHORIZED");

    const missing = await getPrices("does-not-exist", "", ownerToken);
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("NOT_FOUND");
  });
});

describe("GET /items/:id/prices — cursor pagination", () => {
  it("pages newest first via nextCursor until the last page", async () => {
    const item = seedItem({ title: "Coffee" });
    const expected = [
      { price: 5, shop: "S5", observedAt: iso(5) },
      { price: 4, shop: "S4", observedAt: iso(4) },
      { price: 3, shop: "S3", observedAt: iso(3) },
      { price: 2, shop: "S2", observedAt: iso(2) },
      { price: 1, shop: "S1", observedAt: iso(1) },
    ];
    for (const observation of expected) {
      expect((await addPrice(item.id, observation, ownerToken)).statusCode).toBe(201);
    }

    const all = await getPrices(item.id, "", ownerToken);
    expect(all.statusCode).toBe(200);
    // Default limit 50: everything fits on one page.
    expect(all.json()).toEqual({ observations: expected, nextCursor: null });

    // Page 1 of 2.
    const page1 = await getPrices(item.id, "?limit=2", ownerToken);
    expect(page1.json().observations).toEqual(expected.slice(0, 2));
    expect(typeof page1.json().nextCursor).toBe("string");

    // Page 2 of 2.
    const page2 = await getPrices(
      item.id,
      `?limit=2&cursor=${encodeURIComponent(page1.json().nextCursor as string)}`,
      ownerToken,
    );
    expect(page2.json().observations).toEqual(expected.slice(2, 4));
    const cursor2 = page2.json().nextCursor as string;

    // Last page: the remainder, cursor exhausted.
    const page3 = await getPrices(
      item.id,
      `?limit=2&cursor=${encodeURIComponent(cursor2)}`,
      ownerToken,
    );
    expect(page3.json().observations).toEqual(expected.slice(4));
    expect(page3.json().nextCursor).toBeNull();

    // Pages concatenate to the full history without duplicates.
    const pages = [page1, page2, page3];
    const collected = pages.flatMap((page) => page.json().observations);
    expect(collected).toEqual(expected);
  });

  it("accepts the maximum limit and serves an exhausted cursor as an empty last page", async () => {
    const item = seedItem({ title: "Tea" });
    expect(
      (await addPrice(item.id, { price: 2, shop: "Lidl", observedAt: iso(2) })).statusCode,
    ).toBe(201);

    const maxed = await getPrices(item.id, "?limit=100", ownerToken);
    expect(maxed.statusCode).toBe(200);
    expect(maxed.json().observations).toHaveLength(1);
    expect(maxed.json().nextCursor).toBeNull();

    // A cursor older than every observation yields an empty final page.
    const exhausted = Buffer.from(JSON.stringify([iso(1), 0])).toString("base64url");
    const empty = await getPrices(item.id, `?cursor=${encodeURIComponent(exhausted)}`, ownerToken);
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ observations: [], nextCursor: null });
  });

  it("rejects invalid limits and cursors with 400", async () => {
    const item = seedItem({ title: "Honey" });
    for (const query of [
      "?limit=0",
      "?limit=101",
      "?limit=1.5",
      "?limit=abc",
      "?limit=",
      "?cursor=",
      "?cursor=garbage",
      `?cursor=${encodeURIComponent(Buffer.from("null").toString("base64url"))}`,
      `?cursor=${encodeURIComponent(Buffer.from(JSON.stringify(["not-a-date", 0])).toString("base64url"))}`,
      `?cursor=${encodeURIComponent(Buffer.from(JSON.stringify([iso(1), -1])).toString("base64url"))}`,
    ]) {
      const res = await getPrices(item.id, query, ownerToken);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("rejects non-members with 403 and a missing token with 401", async () => {
    const item = seedItem({ title: "Sugar" });
    const forbidden = await getPrices(item.id, "?limit=2", outsiderToken);
    expect(forbidden.statusCode).toBe(403);

    const unauthenticated = await app.inject({
      method: "GET",
      url: `/items/${item.id}/prices?limit=2`,
    });
    expect(unauthenticated.statusCode).toBe(401);
  });
});
