import type { Category, ListRole } from "@grocery/shared";
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
const EDITOR = { email: "editor@example.com", password: "editor-password" };
const VIEWER = { email: "viewer@example.com", password: "viewer-password" };
const OUTSIDER = { email: "outsider@example.com", password: "outsider-password" };

const ALL_USERS = [OWNER, EDITOR, VIEWER, OUTSIDER];

type InjectResponse = Awaited<ReturnType<FastifyInstance["inject"]>>;

let app: FastifyInstance;
let db: Db;
let ownerToken: string;
let editorToken: string;
let viewerToken: string;
let outsiderToken: string;
let familyListId: string;
let otherCategoryId: string;

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

async function createList(token: string, title: string): Promise<InjectResponse> {
  return app.inject({ method: "POST", url: "/lists", headers: bearer(token), payload: { title } });
}

async function addMember(
  owner: string,
  listId: string,
  email: string,
  role: ListRole,
): Promise<InjectResponse> {
  return app.inject({
    method: "POST",
    url: `/lists/${listId}/members`,
    headers: bearer(owner),
    payload: { email, role },
  });
}

/** Scratch list owned by OWNER with the full role matrix. */
async function createScratchList(title: string): Promise<string> {
  const created = await createList(ownerToken, title);
  expect(created.statusCode).toBe(201);
  const listId = created.json().id as string;
  expect((await addMember(ownerToken, listId, EDITOR.email, "EDITOR")).statusCode).toBe(201);
  expect((await addMember(ownerToken, listId, VIEWER.email, "VIEWER")).statusCode).toBe(201);
  return listId;
}

/** The default "Other" category of a list. */
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

function categoryById(categoryId: string): typeof categories.$inferSelect | undefined {
  return db.select().from(categories).where(eq(categories.id, categoryId)).get();
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

  // Seed items in the default Other category: 2 to buy, 1 bought — with
  // distinct addedAt values so daysInList is assertable (3, 0, 1).
  const other = otherCategoryOf(familyListId);
  otherCategoryId = other.id;
  const day = 86_400_000;
  const now = Date.now();
  db.insert(items)
    .values([
      {
        id: createId(),
        listId: familyListId,
        categoryId: other.id,
        title: "Milk",
        qtyText: "2x",
        status: "TO_BUY",
        sortOrder: 0,
        addedAt: new Date(now - 3 * day),
      },
      {
        id: createId(),
        listId: familyListId,
        categoryId: other.id,
        title: "Bread",
        status: "TO_BUY",
        sortOrder: 1,
        addedAt: new Date(now),
      },
      {
        id: createId(),
        listId: familyListId,
        categoryId: other.id,
        title: "Butter",
        status: "BOUGHT",
        sortOrder: 2,
        addedAt: new Date(now - 1 * day),
        boughtAt: new Date(now),
      },
    ])
    .run();
});

describe("GET /lists/:id/categories", () => {
  it("lists the categories ordered by sortOrder with item counts", async () => {
    const scratch = await createScratchList("Ordering");
    const first = await app.inject({
      method: "POST",
      url: `/lists/${scratch}/categories`,
      headers: bearer(ownerToken),
      payload: { title: "Dairy", color: "#3B82F6" },
    });
    const second = await app.inject({
      method: "POST",
      url: `/lists/${scratch}/categories`,
      headers: bearer(ownerToken),
      payload: { title: "Bakery", color: "#F59E0B" },
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);

    const res = await app.inject({
      method: "GET",
      url: `/lists/${scratch}/categories`,
      headers: bearer(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    const cats = res.json() as Category[];
    expect(cats.map((c) => c.title)).toEqual(["Other", "Dairy", "Bakery"]);
    expect(cats.map((c) => c.sortOrder)).toEqual([0, 1, 2]);
    expect(cats.every((c) => c.itemCount === 0)).toBe(true);
    expect(cats[1]).toMatchObject({ title: "Dairy", color: "#3B82F6", itemCount: 0 });
  });

  it("counts items per category (any status)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/lists/${familyListId}/categories`,
      headers: bearer(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    const other = (res.json() as Category[]).find((c) => c.id === otherCategoryId);
    expect(other).toMatchObject({
      id: otherCategoryId,
      title: "Other",
      color: "#6B7280",
      sortOrder: 0,
      itemCount: 3,
    });
  });

  it("allows the VIEWER role to read", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/lists/${familyListId}/categories`,
      headers: bearer(viewerToken),
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as Category[]).some((c) => c.id === otherCategoryId)).toBe(true);
  });

  it("rejects a non-member with 403", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/lists/${familyListId}/categories`,
      headers: bearer(outsiderToken),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  it("rejects an unknown list with 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/lists/does-not-exist/categories",
      headers: bearer(ownerToken),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("rejects a missing token with 401", async () => {
    const res = await app.inject({ method: "GET", url: `/lists/${familyListId}/categories` });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });
});

describe("POST /lists/:id/categories", () => {
  it("creates a category appended after the existing sortOrder (EDITOR allowed)", async () => {
    const scratch = await createScratchList("Create");
    const first = await app.inject({
      method: "POST",
      url: `/lists/${scratch}/categories`,
      headers: bearer(editorToken),
      payload: { title: "Dairy", color: "#3B82F6" },
    });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toEqual({
      id: first.json().id,
      title: "Dairy",
      color: "#3B82F6",
      sortOrder: 1,
      itemCount: 0,
    });

    const second = await app.inject({
      method: "POST",
      url: `/lists/${scratch}/categories`,
      headers: bearer(ownerToken),
      payload: { title: "Bakery", color: "#F59E0B" },
    });
    expect(second.statusCode).toBe(201);
    expect(second.json().sortOrder).toBe(2);

    const rows = db.select().from(categories).where(eq(categories.listId, scratch)).all();
    expect(rows).toHaveLength(3);
  });

  it("rejects VIEWER with 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/lists/${familyListId}/categories`,
      headers: bearer(viewerToken),
      payload: { title: "Hijacked", color: "#FF0000" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  it("rejects a non-member with 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/lists/${familyListId}/categories`,
      headers: bearer(outsiderToken),
      payload: { title: "Hijacked", color: "#FF0000" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("validates title and hex color with 400", async () => {
    for (const payload of [
      { title: "Dairy" },
      { title: "", color: "#3B82F6" },
      { title: "   ", color: "#3B82F6" },
      { title: "Dairy", color: "blue" },
      { title: "Dairy", color: "#12345" },
      { title: "Dairy", color: "#1234567" },
      { title: "Dairy", color: "#3B82F" },
    ]) {
      const res = await app.inject({
        method: "POST",
        url: `/lists/${familyListId}/categories`,
        headers: bearer(ownerToken),
        payload,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("rejects an unknown list with 404", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/lists/does-not-exist/categories",
      headers: bearer(ownerToken),
      payload: { title: "Dairy", color: "#3B82F6" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("rejects a missing token with 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/lists/${familyListId}/categories`,
      payload: { title: "Dairy", color: "#3B82F6" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });
});

describe("PATCH /categories/:id", () => {
  it("updates title and color (EDITOR allowed), preserving itemCount", async () => {
    const scratch = await createScratchList("Patch");
    const created = await app.inject({
      method: "POST",
      url: `/lists/${scratch}/categories`,
      headers: bearer(editorToken),
      payload: { title: "Dairy", color: "#3B82F6" },
    });
    const categoryId = created.json().id as string;

    const res = await app.inject({
      method: "PATCH",
      url: `/categories/${categoryId}`,
      headers: bearer(editorToken),
      payload: { title: "Fresh Dairy", color: "#10B981" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      id: categoryId,
      title: "Fresh Dairy",
      color: "#10B981",
      sortOrder: 1,
      itemCount: 0,
    });
    expect(categoryById(categoryId)).toMatchObject({ title: "Fresh Dairy", color: "#10B981" });
  });

  it("supports a partial patch (color only)", async () => {
    const scratch = await createScratchList("Patch Partial");
    const created = await app.inject({
      method: "POST",
      url: `/lists/${scratch}/categories`,
      headers: bearer(ownerToken),
      payload: { title: "Dairy", color: "#3B82F6" },
    });
    const categoryId = created.json().id as string;

    const res = await app.inject({
      method: "PATCH",
      url: `/categories/${categoryId}`,
      headers: bearer(ownerToken),
      payload: { color: "#EF4444" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ title: "Dairy", color: "#EF4444" });
  });

  it("treats an empty patch as a no-op that still returns the category", async () => {
    const scratch = await createScratchList("Patch Empty");
    const created = await app.inject({
      method: "POST",
      url: `/lists/${scratch}/categories`,
      headers: bearer(ownerToken),
      payload: { title: "Dairy", color: "#3B82F6" },
    });
    const categoryId = created.json().id as string;

    const res = await app.inject({
      method: "PATCH",
      url: `/categories/${categoryId}`,
      headers: bearer(ownerToken),
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(created.json());
  });

  it("rejects VIEWER with 403", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/categories/${otherCategoryId}`,
      headers: bearer(viewerToken),
      payload: { title: "Hijacked" },
    });
    expect(res.statusCode).toBe(403);
    expect(categoryById(otherCategoryId)?.title).toBe("Other");
  });

  it("rejects a non-member with 403", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/categories/${otherCategoryId}`,
      headers: bearer(outsiderToken),
      payload: { title: "Hijacked" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects an unknown category with 404", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/categories/does-not-exist",
      headers: bearer(ownerToken),
      payload: { title: "X" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("validates title and color with 400", async () => {
    for (const payload of [{ title: "   " }, { color: "red" }]) {
      const res = await app.inject({
        method: "PATCH",
        url: `/categories/${otherCategoryId}`,
        headers: bearer(ownerToken),
        payload,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
    }
    expect(categoryById(otherCategoryId)).toMatchObject({ title: "Other", color: "#6B7280" });
  });

  it("rejects a missing token with 401", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/categories/${otherCategoryId}`,
      payload: { title: "X" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });
});

describe("DELETE /categories/:id", () => {
  it("deletes an empty category with 204 (owner-only)", async () => {
    const scratch = await createScratchList("Delete Empty");
    const created = await app.inject({
      method: "POST",
      url: `/lists/${scratch}/categories`,
      headers: bearer(ownerToken),
      payload: { title: "Dairy", color: "#3B82F6" },
    });
    const categoryId = created.json().id as string;

    const res = await app.inject({
      method: "DELETE",
      url: `/categories/${categoryId}`,
      headers: bearer(ownerToken),
    });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe("");
    expect(categoryById(categoryId)).toBeUndefined();
  });

  it("rejects deleting a category that still has items with 409", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/categories/${otherCategoryId}`,
      headers: bearer(ownerToken),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CONFLICT");
    expect(categoryById(otherCategoryId)).toBeDefined();
  });

  it("rejects EDITOR with 403 (owner-only)", async () => {
    const scratch = await createScratchList("Delete Roles");
    const created = await app.inject({
      method: "POST",
      url: `/lists/${scratch}/categories`,
      headers: bearer(ownerToken),
      payload: { title: "Dairy", color: "#3B82F6" },
    });
    const categoryId = created.json().id as string;

    for (const token of [editorToken, viewerToken]) {
      const res = await app.inject({
        method: "DELETE",
        url: `/categories/${categoryId}`,
        headers: bearer(token),
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("FORBIDDEN");
    }
    expect(categoryById(categoryId)).toBeDefined();
  });

  it("rejects a non-member with 403", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/categories/${otherCategoryId}`,
      headers: bearer(outsiderToken),
    });
    expect(res.statusCode).toBe(403);
    expect(categoryById(otherCategoryId)).toBeDefined();
  });

  it("rejects an unknown category with 404", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/categories/does-not-exist",
      headers: bearer(ownerToken),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("rejects a missing token with 401", async () => {
    const res = await app.inject({ method: "DELETE", url: `/categories/${otherCategoryId}` });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });
});

describe("GET /categories/:id/items", () => {
  it("returns all items of the category with computed daysInList", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/categories/${otherCategoryId}/items`,
      headers: bearer(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(["items"]);
    const list = body.items as Array<Record<string, unknown>>;
    expect(list.map((item) => item.title)).toEqual(["Milk", "Bread", "Butter"]);
    expect(list.map((item) => item.daysInList)).toEqual([3, 0, 1]);
    expect(list.map((item) => item.status)).toEqual(["TO_BUY", "TO_BUY", "BOUGHT"]);
    for (const item of list) {
      expect(item.category).toEqual({ id: otherCategoryId, title: "Other", color: "#6B7280" });
      expect(item.imageFilename).toBeNull();
      expect(String(item.addedAt)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    }
    expect(list[0]).toMatchObject({ title: "Milk", qtyText: "2x", sortOrder: 0 });
  });

  it("allows the VIEWER role to read", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/categories/${otherCategoryId}/items`,
      headers: bearer(viewerToken),
    });
    expect(res.statusCode).toBe(200);
    expect((res.json().items as unknown[]).length).toBeGreaterThan(0);
  });

  it("rejects a non-member with 403", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/categories/${otherCategoryId}/items`,
      headers: bearer(outsiderToken),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  it("rejects an unknown category with 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/categories/does-not-exist/items",
      headers: bearer(ownerToken),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("rejects a missing token with 401", async () => {
    const res = await app.inject({ method: "GET", url: `/categories/${otherCategoryId}/items` });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });
});
