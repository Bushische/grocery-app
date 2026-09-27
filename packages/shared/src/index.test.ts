import { describe, expect, it } from "vitest";
import { API_BASE_PATH, loginRequestSchema, loginResponseSchema } from "./index";

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
