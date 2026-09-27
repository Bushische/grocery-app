import { describe, expect, it } from "vitest";
import {
  API_BASE_PATH,
  addListMemberRequestSchema,
  createListRequestSchema,
  listRoleSchema,
  listSummarySchema,
  loginRequestSchema,
  loginResponseSchema,
} from "./index";

describe("shared package", () => {
  it("exports the API base path", () => {
    expect(API_BASE_PATH).toBe("/api");
  });
});

describe("loginRequestSchema", () => {
  it("trims and lowercases the email", () => {
    const parsed = loginRequestSchema.parse({ email: "  Alex@Example.COM ", password: "secret" });
    expect(parsed).toEqual({ email: "alex@example.com", password: "secret" });
  });

  it("rejects non-email addresses and empty passwords", () => {
    expect(loginRequestSchema.safeParse({ email: "nope", password: "secret" }).success).toBe(false);
    expect(loginRequestSchema.safeParse({ email: "a@b.co", password: "" }).success).toBe(false);
    expect(loginRequestSchema.safeParse({ password: "secret" }).success).toBe(false);
  });
});

describe("loginResponseSchema", () => {
  it("requires accessToken and a user with id, email, role", () => {
    const value = { accessToken: "eyJ...", user: { id: "u1", email: "a@b.co", role: "admin" } };
    expect(loginResponseSchema.parse(value)).toEqual(value);
    expect(
      loginResponseSchema.safeParse({ user: { id: "u1", email: "a@b.co", role: "admin" } }).success,
    ).toBe(false);
    expect(
      loginResponseSchema.safeParse({
        accessToken: "x",
        user: { id: "u1", email: "a@b.co", role: "superuser" },
      }).success,
    ).toBe(false);
  });
});

describe("list schemas", () => {
  it("createListRequestSchema trims the title and rejects empty or whitespace-only titles", () => {
    expect(createListRequestSchema.parse({ title: "  Weekly " })).toEqual({ title: "Weekly" });
    expect(createListRequestSchema.safeParse({ title: "" }).success).toBe(false);
    expect(createListRequestSchema.safeParse({ title: "   " }).success).toBe(false);
    expect(createListRequestSchema.safeParse({}).success).toBe(false);
  });

  it("listRoleSchema accepts only OWNER, EDITOR, VIEWER", () => {
    expect(listRoleSchema.parse("OWNER")).toBe("OWNER");
    expect(listRoleSchema.parse("EDITOR")).toBe("EDITOR");
    expect(listRoleSchema.parse("VIEWER")).toBe("VIEWER");
    expect(listRoleSchema.safeParse("ADMIN").success).toBe(false);
    expect(listRoleSchema.safeParse("owner").success).toBe(false);
  });

  it("addListMemberRequestSchema normalizes the email and validates the role", () => {
    expect(
      addListMemberRequestSchema.parse({ email: " Mom@Example.COM ", role: "EDITOR" }),
    ).toEqual({ email: "mom@example.com", role: "EDITOR" });
    expect(addListMemberRequestSchema.safeParse({ email: "nope", role: "EDITOR" }).success).toBe(
      false,
    );
    expect(addListMemberRequestSchema.safeParse({ email: "a@b.co", role: "GOD" }).success).toBe(
      false,
    );
  });

  it("listSummarySchema requires id, title, role, and itemCounts", () => {
    const value = { id: "l1", title: "Weekly", role: "OWNER", itemCounts: { toBuy: 5, bought: 2 } };
    expect(listSummarySchema.parse(value)).toEqual(value);
    expect(listSummarySchema.safeParse({ ...value, itemCounts: { toBuy: 1 } }).success).toBe(false);
    expect(listSummarySchema.safeParse({ ...value, role: "GOD" }).success).toBe(false);
    expect(
      listSummarySchema.safeParse({ ...value, itemCounts: { toBuy: -1, bought: 0 } }).success,
    ).toBe(false);
  });
});
