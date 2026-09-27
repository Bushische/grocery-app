import type { ListRole, ListSummary } from "@grocery/shared";
import { createId } from "@paralleldrive/cuid2";
import { hashSync } from "bcryptjs";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { loadConfig } from "../config";
import { type Db, createDb, createSqlite } from "../db/client";
import { runMigrations } from "../db/migrate";
import { categories, groceryLists, items, listMembers, users } from "../db/schema";

const OWNER = { email: "owner@example.com", password: "owner-password" };
const EDITOR = { email: "editor@example.com", password: "editor-password" };
const VIEWER = { email: "viewer@example.com", password: "viewer-password" };
const OUTSIDER = { email: "outsider@example.com", password: "outsider-password" };
const PROSPECT = { email: "prospect@example.com", password: "prospect-password" };

const ALL_USERS = [OWNER, EDITOR, VIEWER, OUTSIDER, PROSPECT];

type InjectResponse = Awaited<ReturnType<FastifyInstance["inject"]>>;

let app: FastifyInstance;
let db: Db;
let ownerToken: string;
let editorToken: string;
let viewerToken: string;
let outsiderToken: string;
let familyListId: string;
let personalListId: string;

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

async function login(email: string, password: string): Promise<InjectResponse> {
  return app.inject({ method: "POST", url: "/auth/login", payload: { email, password } });
}

async function accessToken(email: string, password: string): Promise<string> {
  const res = await login(email, password);
  expect(res.statusCode).toBe(200);
  return res.json().accessToken;
}

function userIdByEmail(email: string): string {
  const user = db.select({ id: users.id }).from(users).where(eq(users.email, email)).get();
  if (!user) throw new Error(`user ${email} not found`);
  return user.id;
}

async function createList(token: string, title: string): Promise<InjectResponse> {
  return app.inject({
    method: "POST",
    url: "/lists",
    headers: bearer(token),
    payload: { title },
  });
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

/** Self-contained scratch list (owner + PROSPECT as EDITOR) for member tests. */
async function createListWithProspect(title: string): Promise<string> {
  const created = await createList(ownerToken, title);
  expect(created.statusCode).toBe(201);
  const listId = created.json().id;
  const added = await addMember(ownerToken, listId, PROSPECT.email, "EDITOR");
  expect(added.statusCode).toBe(201);
  return listId;
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

  const family = await createList(ownerToken, "Family");
  familyListId = family.json().id;
  expect((await addMember(ownerToken, familyListId, EDITOR.email, "EDITOR")).statusCode).toBe(201);
  expect((await addMember(ownerToken, familyListId, VIEWER.email, "VIEWER")).statusCode).toBe(201);

  const personal = await createList(ownerToken, "Personal");
  personalListId = personal.json().id;

  // Seed items for the itemCounts assertions: 2 to buy, 1 bought.
  const otherCategory = db
    .select()
    .from(categories)
    .where(and(eq(categories.listId, familyListId), eq(categories.title, "Other")))
    .get();
  if (!otherCategory) throw new Error("default Other category missing");
  db.insert(items)
    .values([
      {
        id: createId(),
        listId: familyListId,
        categoryId: otherCategory.id,
        title: "Milk",
        status: "TO_BUY",
        sortOrder: 0,
      },
      {
        id: createId(),
        listId: familyListId,
        categoryId: otherCategory.id,
        title: "Bread",
        status: "TO_BUY",
        sortOrder: 1,
      },
      {
        id: createId(),
        listId: familyListId,
        categoryId: otherCategory.id,
        title: "Butter",
        status: "BOUGHT",
        sortOrder: 0,
        boughtAt: new Date(),
      },
    ])
    .run();
});

describe("GET /lists", () => {
  it("returns only the caller's lists with their role and itemCounts", async () => {
    const res = await app.inject({ method: "GET", url: "/lists", headers: bearer(ownerToken) });
    expect(res.statusCode).toBe(200);
    const lists = res.json() as ListSummary[];
    expect(lists.map((list) => list.title).sort()).toEqual(["Family", "Personal"]);
    const family = lists.find((list) => list.title === "Family");
    expect(family).toEqual({
      id: familyListId,
      title: "Family",
      role: "OWNER",
      itemCounts: { toBuy: 2, bought: 1 },
    });
    const personal = lists.find((list) => list.title === "Personal");
    expect(personal).toEqual({
      id: personalListId,
      title: "Personal",
      role: "OWNER",
      itemCounts: { toBuy: 0, bought: 0 },
    });
  });

  it("shows the EDITOR role and the same itemCounts to an editor (read allowed)", async () => {
    const res = await app.inject({ method: "GET", url: "/lists", headers: bearer(editorToken) });
    expect(res.statusCode).toBe(200);
    const lists = res.json() as ListSummary[];
    expect(lists).toHaveLength(1);
    expect(lists[0]).toEqual({
      id: familyListId,
      title: "Family",
      role: "EDITOR",
      itemCounts: { toBuy: 2, bought: 1 },
    });
  });

  it("shows the VIEWER role to a viewer (read allowed)", async () => {
    const res = await app.inject({ method: "GET", url: "/lists", headers: bearer(viewerToken) });
    expect(res.statusCode).toBe(200);
    const lists = res.json() as ListSummary[];
    expect(lists).toHaveLength(1);
    expect(lists[0]).toMatchObject({ id: familyListId, title: "Family", role: "VIEWER" });
  });

  it("hides lists the caller is not a member of", async () => {
    const res = await app.inject({ method: "GET", url: "/lists", headers: bearer(outsiderToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("rejects a missing token with 401", async () => {
    const res = await app.inject({ method: "GET", url: "/lists" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });
});

describe("POST /lists", () => {
  it("creates a list, makes the creator OWNER, and auto-creates the default Other category", async () => {
    const res = await createList(outsiderToken, "Weekend");
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(["id", "itemCounts", "role", "title"]);
    expect(body).toEqual({
      id: body.id,
      title: "Weekend",
      role: "OWNER",
      itemCounts: { toBuy: 0, bought: 0 },
    });

    const created = db.select().from(groceryLists).where(eq(groceryLists.id, body.id)).get();
    expect(created).toMatchObject({ title: "Weekend", ownerId: userIdByEmail(OUTSIDER.email) });

    const membership = db
      .select()
      .from(listMembers)
      .where(
        and(eq(listMembers.listId, body.id), eq(listMembers.userId, userIdByEmail(OUTSIDER.email))),
      )
      .get();
    expect(membership?.role).toBe("OWNER");

    const createdCategories = db
      .select()
      .from(categories)
      .where(eq(categories.listId, body.id))
      .all();
    expect(createdCategories).toHaveLength(1);
    expect(createdCategories[0]).toMatchObject({
      title: "Other",
      color: "#6B7280",
      sortOrder: 0,
    });
  });

  it("validates the title", async () => {
    for (const title of ["", "   ", undefined]) {
      const res = await app.inject({
        method: "POST",
        url: "/lists",
        headers: bearer(ownerToken),
        payload: { title },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("rejects a missing token with 401", async () => {
    const res = await app.inject({ method: "POST", url: "/lists", payload: { title: "X" } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });
});

describe("GET /lists/:id", () => {
  it("returns id, title, owner, and all members for any member role", async () => {
    for (const token of [ownerToken, editorToken, viewerToken]) {
      const res = await app.inject({
        method: "GET",
        url: `/lists/${familyListId}`,
        headers: bearer(token),
      });
      expect(res.statusCode).toBe(200);
      const detail = res.json();
      expect(Object.keys(detail).sort()).toEqual(["id", "members", "owner", "title"]);
      expect(detail.id).toBe(familyListId);
      expect(detail.title).toBe("Family");
      expect(detail.owner).toEqual({ id: userIdByEmail(OWNER.email), email: OWNER.email });
      expect(detail.members).toEqual([
        { userId: userIdByEmail(OWNER.email), email: OWNER.email, role: "OWNER" },
        { userId: userIdByEmail(EDITOR.email), email: EDITOR.email, role: "EDITOR" },
        { userId: userIdByEmail(VIEWER.email), email: VIEWER.email, role: "VIEWER" },
      ]);
    }
  });

  it("rejects a non-member with 403", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/lists/${familyListId}`,
      headers: bearer(outsiderToken),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  it("rejects an unknown list id with 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/lists/does-not-exist",
      headers: bearer(ownerToken),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("rejects a missing token with 401", async () => {
    const res = await app.inject({ method: "GET", url: `/lists/${familyListId}` });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });
});

describe("PATCH /lists/:id", () => {
  it("renames the list for the OWNER", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/lists/${familyListId}`,
      headers: bearer(ownerToken),
      payload: { title: "Family Shopping" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      id: familyListId,
      title: "Family Shopping",
      role: "OWNER",
      itemCounts: { toBuy: 2, bought: 1 },
    });
    const renamed = db.select().from(groceryLists).where(eq(groceryLists.id, familyListId)).get();
    expect(renamed?.title).toBe("Family Shopping");
  });

  it("rejects EDITOR and VIEWER with 403 (owner-only)", async () => {
    for (const token of [editorToken, viewerToken]) {
      const res = await app.inject({
        method: "PATCH",
        url: `/lists/${familyListId}`,
        headers: bearer(token),
        payload: { title: "Hijacked" },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("FORBIDDEN");
    }
    const unchanged = db.select().from(groceryLists).where(eq(groceryLists.id, familyListId)).get();
    expect(unchanged?.title).toBe("Family Shopping");
  });

  it("rejects a non-member with 403", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/lists/${familyListId}`,
      headers: bearer(outsiderToken),
      payload: { title: "Hijacked" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  it("validates the title", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/lists/${familyListId}`,
      headers: bearer(ownerToken),
      payload: { title: "  " },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects an unknown list id with 404", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/lists/does-not-exist",
      headers: bearer(ownerToken),
      payload: { title: "X" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("rejects a missing token with 401", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/lists/${familyListId}`,
      payload: { title: "X" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });
});

describe("DELETE /lists/:id", () => {
  it("deletes the list for the OWNER and cascades to members and categories", async () => {
    const created = await createList(ownerToken, "Junk");
    const junkId = created.json().id;

    const res = await app.inject({
      method: "DELETE",
      url: `/lists/${junkId}`,
      headers: bearer(ownerToken),
    });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe("");
    expect(db.select().from(groceryLists).where(eq(groceryLists.id, junkId)).get()).toBeUndefined();
    expect(db.select().from(listMembers).where(eq(listMembers.listId, junkId)).all()).toHaveLength(
      0,
    );
    expect(db.select().from(categories).where(eq(categories.listId, junkId)).all()).toHaveLength(0);
  });

  it("rejects EDITOR and VIEWER with 403 and keeps the list", async () => {
    for (const token of [editorToken, viewerToken]) {
      const res = await app.inject({
        method: "DELETE",
        url: `/lists/${familyListId}`,
        headers: bearer(token),
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("FORBIDDEN");
    }
    expect(
      db.select().from(groceryLists).where(eq(groceryLists.id, familyListId)).get(),
    ).toBeDefined();
  });

  it("rejects a non-member with 403", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/lists/${familyListId}`,
      headers: bearer(outsiderToken),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  it("rejects an unknown list id with 404", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/lists/does-not-exist",
      headers: bearer(ownerToken),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("rejects a missing token with 401", async () => {
    const res = await app.inject({ method: "DELETE", url: `/lists/${familyListId}` });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });
});

describe("POST /lists/:id/members", () => {
  it("adds a member by email for the OWNER", async () => {
    const res = await addMember(ownerToken, familyListId, PROSPECT.email, "EDITOR");
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      userId: userIdByEmail(PROSPECT.email),
      email: PROSPECT.email,
      role: "EDITOR",
    });
    const membership = db
      .select()
      .from(listMembers)
      .where(
        and(
          eq(listMembers.listId, familyListId),
          eq(listMembers.userId, userIdByEmail(PROSPECT.email)),
        ),
      )
      .get();
    expect(membership?.role).toBe("EDITOR");
  });

  it("rejects an already-member user with 409", async () => {
    const res = await addMember(ownerToken, familyListId, EDITOR.email, "VIEWER");
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CONFLICT");
  });

  it("rejects an unknown email with 404", async () => {
    const res = await addMember(ownerToken, familyListId, "ghost@example.com", "VIEWER");
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("rejects EDITOR and VIEWER with 403 (owner-only)", async () => {
    for (const token of [editorToken, viewerToken]) {
      const res = await addMember(token, familyListId, OUTSIDER.email, "VIEWER");
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("FORBIDDEN");
    }
  });

  it("validates email and role", async () => {
    for (const payload of [
      { email: "not-an-email", role: "VIEWER" },
      { email: VIEWER.email, role: "GOD" },
      { role: "VIEWER" },
    ]) {
      const res = await app.inject({
        method: "POST",
        url: `/lists/${familyListId}/members`,
        headers: bearer(ownerToken),
        payload,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("rejects a missing token with 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/lists/${familyListId}/members`,
      payload: { email: VIEWER.email, role: "VIEWER" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });
});

describe("PATCH /lists/:id/members/:userId", () => {
  it("changes a member's role for the OWNER", async () => {
    const listId = await createListWithProspect("Patch Member");
    const prospectId = userIdByEmail(PROSPECT.email);

    const res = await app.inject({
      method: "PATCH",
      url: `/lists/${listId}/members/${prospectId}`,
      headers: bearer(ownerToken),
      payload: { role: "VIEWER" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ userId: prospectId, email: PROSPECT.email, role: "VIEWER" });
    const membership = db
      .select()
      .from(listMembers)
      .where(and(eq(listMembers.listId, listId), eq(listMembers.userId, prospectId)))
      .get();
    expect(membership?.role).toBe("VIEWER");
  });

  it("rejects changing the list owner's role with 409", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/lists/${familyListId}/members/${userIdByEmail(OWNER.email)}`,
      headers: bearer(ownerToken),
      payload: { role: "VIEWER" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CONFLICT");
  });

  it("rejects EDITOR and VIEWER with 403 (owner-only)", async () => {
    for (const token of [editorToken, viewerToken]) {
      const res = await app.inject({
        method: "PATCH",
        url: `/lists/${familyListId}/members/${userIdByEmail(VIEWER.email)}`,
        headers: bearer(token),
        payload: { role: "EDITOR" },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("FORBIDDEN");
    }
  });

  it("rejects a non-member target with 404", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/lists/${familyListId}/members/${userIdByEmail(OUTSIDER.email)}`,
      headers: bearer(ownerToken),
      payload: { role: "EDITOR" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("validates the role", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/lists/${familyListId}/members/${userIdByEmail(EDITOR.email)}`,
      headers: bearer(ownerToken),
      payload: { role: "GOD" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a missing token with 401", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/lists/${familyListId}/members/${userIdByEmail(EDITOR.email)}`,
      payload: { role: "VIEWER" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });
});

describe("DELETE /lists/:id/members/:userId", () => {
  it("removes a member for the OWNER", async () => {
    const listId = await createListWithProspect("Remove Member");
    const prospectId = userIdByEmail(PROSPECT.email);

    const res = await app.inject({
      method: "DELETE",
      url: `/lists/${listId}/members/${prospectId}`,
      headers: bearer(ownerToken),
    });
    expect(res.statusCode).toBe(204);
    expect(
      db
        .select()
        .from(listMembers)
        .where(and(eq(listMembers.listId, listId), eq(listMembers.userId, prospectId)))
        .get(),
    ).toBeUndefined();
  });

  it("rejects removing the list owner with 409", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/lists/${familyListId}/members/${userIdByEmail(OWNER.email)}`,
      headers: bearer(ownerToken),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CONFLICT");
  });

  it("rejects removing a user who is not a member with 404", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/lists/${familyListId}/members/${userIdByEmail(OUTSIDER.email)}`,
      headers: bearer(ownerToken),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("rejects EDITOR and VIEWER with 403 (owner-only)", async () => {
    for (const token of [editorToken, viewerToken]) {
      const res = await app.inject({
        method: "DELETE",
        url: `/lists/${familyListId}/members/${userIdByEmail(VIEWER.email)}`,
        headers: bearer(token),
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("FORBIDDEN");
    }
  });

  it("rejects an unknown list id with 404", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/lists/does-not-exist/members/${userIdByEmail(EDITOR.email)}`,
      headers: bearer(ownerToken),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("rejects a missing token with 401", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/lists/${familyListId}/members/${userIdByEmail(EDITOR.email)}`,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });
});
