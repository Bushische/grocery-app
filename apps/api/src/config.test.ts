import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";

describe("loadConfig", () => {
  it("treats an unset CORS_ORIGIN as allow-same-origin (undefined)", () => {
    const config = loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent" });
    expect(config.corsOrigins).toBe(true);
  });

  it("accepts an empty CORS_ORIGIN (compose default) like unset", () => {
    const config = loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", CORS_ORIGIN: "" });
    expect(config.corsOrigins).toBe(true);
  });

  it("accepts a whitespace-only CORS_ORIGIN like unset", () => {
    const config = loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", CORS_ORIGIN: "   " });
    expect(config.corsOrigins).toBe(true);
  });

  it("parses a single CORS_ORIGIN into the allowlist", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      CORS_ORIGIN: "https://grocery.example.com",
    });
    expect(config.corsOrigins).toEqual(["https://grocery.example.com"]);
  });

  it("parses a comma-separated CORS_ORIGIN list, trimming entries", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      CORS_ORIGIN: "https://a.example.com , https://b.example.com",
    });
    expect(config.corsOrigins).toEqual(["https://a.example.com", "https://b.example.com"]);
  });

  it("rejects the dev JWT secret in production", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        LOG_LEVEL: "silent",
        JWT_SECRET: "dev-only-insecure-secret",
      }),
    ).toThrow(/JWT_SECRET/);
  });
});
