import type { SearchResponse, SuggestResponse } from "@grocery/shared";
import { createId } from "@paralleldrive/cuid2";
import { hashSync } from "bcryptjs";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { loadConfig } from "../config";
import { type Db, createDb, createSqlite } from "../db/client";
import { runMigrations } from "../db/migrate";
import { categories, items, users } from "../db/schema";

const OWNER = { email: "owner@example.com", password: "owner-password" };
const VIEWER = { email: "viewer@example.com", password: "viewer-password" };
const OUTSIDER = { email: "outsider@example.com", password: "outsider-password" };

const ALL_USERS = [OWNER, VIEWER, OUTSIDER];

let app: FastifyInstance;
let db: Db;
let ownerToken: string;
let viewerToken: string;
let outsiderToken: string;
let listId: string;
let dairyCategory: typeof categories.$inferSelect;
let otherCategory: typeof categories.$inferSelect;
let otherCategoryId: string;

function buildTestApp(): { app: FastifyInstance; db: Db } {
  const sqlite = createSqlite(":memory:");
  const database = createDb(sqlite);
  runMigrations(database);
  const built = buildApp(
    loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", UPLOADS_PATH: "data/uploads-test" }),
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

function seedItem(listId: string, categoryId: string, values: Partial<typeof items.$inferInsert>) {
  return db
    .insert(items)
    .values({ id: createId(), listId, categoryId, title: "Untitled", ...values })
    .returning()
    .get();
}

function suggest(query: string, target = listId, token = ownerToken) {
  return app.inject({
    method: "GET",
    url: `/items/suggest?q=${encodeURIComponent(query)}&listId=${target}`,
    headers: bearer(token),
  });
}

async function addMember(listId: string, email: string, role: "EDITOR" | "VIEWER") {
  const res = await app.inject({
    method: "POST",
    url: `/lists/${listId}/members`,
    headers: bearer(ownerToken),
    payload: { email, role },
  });
  expect(res.statusCode).toBe(201);
}

function search(query: string, withListId?: string, token = ownerToken) {
  const listSuffix = withListId ? `&listId=${withListId}` : "";
  return app.inject({
    method: "GET",
    url: `/search?q=${encodeURIComponent(query)}${listSuffix}`,
    headers: bearer(token),
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
  viewerToken = await accessToken(VIEWER.email, VIEWER.password);
  outsiderToken = await accessToken(OUTSIDER.email, OUTSIDER.password);

  listId = await createList(ownerToken, "Search List");
  otherCategory = otherCategoryOf(listId);
  otherCategoryId = otherCategory.id;
  dairyCategory = db
    .insert(categories)
    .values({
      id: createId(),
      listId,
      title: "Dairy",
      color: "#3B82F6",
      sortOrder: 0,
    })
    .returning()
    .get();
  // The auto-created "Other" sits at sortOrder 0; Dairy takes precedence.
  db.update(categories).set({ sortOrder: 1 }).where(eq(categories.id, otherCategory.id)).run();
  await addMember(listId, VIEWER.email, "VIEWER");

  // usageCount drives the suggest/search ordering: "Milk" most used.
  seedItem(listId, dairyCategory.id, {
    title: "Milk",
    status: "TO_BUY",
    sortOrder: 0,
    addedAt: new Date(),
    usageCount: 5,
  });
  seedItem(listId, dairyCategory.id, {
    title: "Oat Milk",
    status: "BOUGHT",
    sortOrder: 1,
    addedAt: new Date(),
    usageCount: 2,
  });
  seedItem(listId, otherCategoryId, {
    title: "Bread",
    status: "TO_BUY",
    sortOrder: 0,
    addedAt: new Date(),
    usageCount: 1,
  });
  // High-usage Dairy item so the Dairy group survives the 20-item cap test.
  seedItem(listId, dairyCategory.id, {
    title: "Cream",
    status: "TO_BUY",
    sortOrder: 2,
    addedAt: new Date(),
    usageCount: 30,
  });
});

describe("GET /items/suggest", () => {
  it("groups matches by category with color bars", async () => {
    const res = await suggest("mi");
    expect(res.statusCode).toBe(200);
    const body = res.json() as SuggestResponse;
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0]!.category).toEqual({
      id: dairyCategory.id,
      title: "Dairy",
      color: "#3B82F6",
    });
    expect(body.groups[0]!.items.map((item) => item.title)).toEqual(["Milk", "Oat Milk"]);
    expect(body.groups[0]!.items[0]).toEqual({
      id: expect.any(String),
      title: "Milk",
      qtyText: null,
      status: "TO_BUY",
    });
  });

  it("orders fuzzy matches by usageCount DESC", async () => {
    const res = await suggest("mil");
    expect(res.statusCode).toBe(200);
    const titles = (res.json() as SuggestResponse).groups.flatMap((group) =>
      group.items.map((item) => item.title),
    );
    // "Oat Milk" only matches fuzzily (no substring of "mil" except via "Milk");
    // both appear, ranked by usageCount: Milk (5) before Oat Milk (2).
    expect(titles).toContain("Milk");
    expect(titles).toContain("Oat Milk");
    expect(titles.indexOf("Milk")).toBeLessThan(titles.indexOf("Oat Milk"));
  });

  it("groups across categories in category sortOrder order and caps at 20 items", async () => {
    for (let index = 0; index < 25; index++) {
      seedItem(listId, otherCategoryId, {
        title: `Cereal Brand ${index}`,
        status: "TO_BUY",
        sortOrder: 10 + index,
        addedAt: new Date(),
        usageCount: index,
      });
    }
    const res = await suggest("a");
    expect(res.statusCode).toBe(200);
    const body = res.json() as SuggestResponse;
    const groupTitles = body.groups.map((group) => group.category.title);
    expect(groupTitles[0]).toBe("Dairy");
    expect(groupTitles).toContain("Other");
    const flat = body.groups.flatMap((group) => group.items);
    expect(flat).toHaveLength(20);
    const usageCounts = flat.map(
      (item) => db.select().from(items).where(eq(items.id, item.id)).get()!.usageCount,
    );
    expect([...usageCounts].sort((a, b) => b - a)).toEqual(usageCounts);
  });

  it("returns 400 for an empty query", async () => {
    const res = await suggest("");
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("requires auth, membership, and an existing list; VIEWER can read", async () => {
    expect((await suggest("mil", listId, outsiderToken)).statusCode).toBe(403);
    expect((await suggest("mil", "does-not-exist", ownerToken)).statusCode).toBe(404);
    const noAuth = await app.inject({ method: "GET", url: `/items/suggest?q=mi&listId=${listId}` });
    expect(noAuth.statusCode).toBe(401);
    expect((await suggest("mil", listId, viewerToken)).statusCode).toBe(200);
  });
});

describe("GET /search", () => {
  it("finds items across the user's lists with category colors", async () => {
    const res = await search("bread");
    expect(res.statusCode).toBe(200);
    const body = res.json() as SearchResponse;
    const match = body.results.find((result) => result.title === "Bread");
    expect(match).toMatchObject({
      listId,
      title: "Bread",
      status: "TO_BUY",
      categoryColor: otherCategory.color,
    });
    expect(match!.itemId).toEqual(expect.any(String));
  });

  it("matches in both directions (query containing title)", async () => {
    const res = await search("fresh bread loaf");
    const titles = (res.json() as SearchResponse).results.map((result) => result.title);
    expect(titles).toContain("Bread");
    expect(titles).not.toContain("Milk");
  });

  it("never leaks items of lists the user is not a member of", async () => {
    const foreignListId = await createList(outsiderToken, "Foreign");
    seedItem(foreignListId, otherCategoryOf(foreignListId).id, {
      title: "Secret Butter",
      status: "TO_BUY",
      sortOrder: 0,
      addedAt: new Date(),
    });
    const all = await search("secret");
    expect(all.statusCode).toBe(200);
    expect((all.json() as SearchResponse).results).toHaveLength(0);
    const foreign = await search("butter", foreignListId, ownerToken);
    expect(foreign.statusCode).toBe(200);
    expect((foreign.json() as SearchResponse).results).toHaveLength(0);
  });

  it("filters by listId", async () => {
    const res = await search("milk", listId);
    expect(res.statusCode).toBe(200);
    const results = (res.json() as SearchResponse).results;
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.listId).toBe(listId);
    }
  });

  it("returns 400 for an empty query and 401 without auth", async () => {
    expect((await search("")).statusCode).toBe(400);
    expect((await search("")).json().error.code).toBe("VALIDATION_ERROR");
    const noAuth = await app.inject({ method: "GET", url: "/search?q=mi" });
    expect(noAuth.statusCode).toBe(401);
  });
});
