import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app";
import { loadConfig } from "./config";

let app: FastifyInstance;

beforeAll(async () => {
  const uploadsDir = mkdtempSync(join(tmpdir(), "grocery-uploads-"));
  writeFileSync(join(uploadsDir, "probe.txt"), "static-ok");
  app = buildApp(
    loadConfig({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      UPLOADS_PATH: uploadsDir,
    }),
  );
  await app.ready();
});

describe("GET /health", () => {
  it("returns 200 { status: ok } per docs/API.md", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });
});

describe("unknown routes", () => {
  it("return the standard error shape from docs/API.md", async () => {
    const res = await app.inject({ method: "GET", url: "/definitely-not-a-route" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
    expect(typeof res.json().error.message).toBe("string");
    expect(res.json().error.message).toContain("/definitely-not-a-route");
  });
});

describe("credentialed CORS", () => {
  it("reflects the origin and allows credentials on preflight", async () => {
    const res = await app.inject({
      method: "OPTIONS",
      url: "/health",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "GET",
      },
    });
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });
});

describe("plugins", () => {
  it("registers @fastify/cookie (request.cookies decorator)", () => {
    expect(app.hasRequestDecorator("cookies")).toBe(true);
  });

  it("registers @fastify/jwt (jwt decorator)", () => {
    expect(app.hasDecorator("jwt")).toBe(true);
  });

  it("registers @fastify/multipart with a multipart content-type parser", () => {
    expect(app.hasContentTypeParser("multipart/form-data")).toBe(true);
  });

  it("registers @fastify/static and serves the uploads dir under /static", async () => {
    const res = await app.inject({ method: "GET", url: "/static/probe.txt" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("static-ok");
  });

  it("caches /static responses as immutable for one year (T4.5)", async () => {
    const res = await app.inject({ method: "GET", url: "/static/probe.txt" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  it("keeps the default ETag on /static responses as fallback", async () => {
    const res = await app.inject({ method: "GET", url: "/static/probe.txt" });
    expect(res.headers.etag).toBeDefined();
  });

  it("registers @fastify/helmet security headers", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });
});
