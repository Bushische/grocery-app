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

describe("loadConfig OAuth client credentials (T50)", () => {
  it("defaults to the alice client with the seeded dev secret", () => {
    const config = loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent" });
    expect(config.oauthClientId).toBe("alice");
    expect(config.oauthClientSecret).toBe("alice-dev-secret-change-me");
  });

  it("reads the client id/secret from the environment", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      OAUTH_CLIENT_ID: "alice",
      OAUTH_CLIENT_SECRET: "prod-random-secret",
    });
    expect(config.oauthClientId).toBe("alice");
    expect(config.oauthClientSecret).toBe("prod-random-secret");
  });
});

describe("loadConfig CORS_ORIGIN production gate (T34)", () => {
  const productionEnv = {
    NODE_ENV: "production",
    LOG_LEVEL: "silent",
    JWT_SECRET: "test-production-secret",
  };

  it("rejects an unset CORS_ORIGIN in production with an explicit error", () => {
    expect(() => loadConfig(productionEnv)).toThrow("CORS_ORIGIN must be set in production");
  });

  it("rejects an empty or whitespace-only CORS_ORIGIN in production", () => {
    for (const CORS_ORIGIN of ["", "   "]) {
      expect(() => loadConfig({ ...productionEnv, CORS_ORIGIN })).toThrow(/CORS_ORIGIN/);
    }
  });

  it("rejects a CORS_ORIGIN that parses to an empty allowlist in production", () => {
    expect(() => loadConfig({ ...productionEnv, CORS_ORIGIN: " , , " })).toThrow(/CORS_ORIGIN/);
  });

  it("boots in production with a CORS_ORIGIN value (allowlist semantics unchanged)", () => {
    const config = loadConfig({
      ...productionEnv,
      CORS_ORIGIN: "https://grocery.example.com",
    });
    expect(config.isProduction).toBe(true);
    expect(config.corsOrigins).toEqual(["https://grocery.example.com"]);
  });

  it("still boots outside production with an empty CORS_ORIGIN (NODE_ENV unset)", () => {
    const config = loadConfig({ LOG_LEVEL: "silent", CORS_ORIGIN: "" });
    expect(config.isProduction).toBe(false);
    expect(config.corsOrigins).toBe(true);
  });
});
