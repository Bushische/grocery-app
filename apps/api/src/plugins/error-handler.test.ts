import Fastify, { type FastifyInstance } from "fastify";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { FastifyHttpError } from "../errors";
import { applyErrorHandling } from "./error-handler";

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ logger: false });
  applyErrorHandling(app);

  app.get("/conflict", async () => {
    throw new FastifyHttpError(409, "CONFLICT", "category still has items");
  });
  app.get("/zod", async () => {
    z.string().min(1).parse("");
  });
  app.post(
    "/strict",
    {
      schema: {
        body: { type: "object", required: ["name"], properties: { name: { type: "string" } } },
      },
    },
    async () => ({ ok: true }),
  );
  app.get("/boom", async () => {
    throw new Error("kaboom");
  });

  await app.ready();
});

describe("error handler", () => {
  it("maps FastifyHttpError to the contract shape with its status", async () => {
    const res = await app.inject({ method: "GET", url: "/conflict" });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      error: { code: "CONFLICT", message: "category still has items" },
    });
  });

  it("maps zod errors to 400 VALIDATION_ERROR", async () => {
    const res = await app.inject({ method: "GET", url: "/zod" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    expect(typeof res.json().error.message).toBe("string");
  });

  it("maps fastify schema validation to 400 VALIDATION_ERROR", async () => {
    const res = await app.inject({ method: "POST", url: "/strict", payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("hides internals of unexpected errors behind 500 INTERNAL_ERROR", async () => {
    const res = await app.inject({ method: "GET", url: "/boom" });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
    expect(JSON.stringify(res.json())).not.toContain("kaboom");
  });
});
