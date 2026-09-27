import {
  apiTokenCreatedSchema,
  apiTokenSchema,
  createApiTokenRequestSchema,
} from "@grocery/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../plugins/auth";
import * as apiTokenService from "../services/apiTokenService";

const tokenIdParamsSchema = z.object({ id: z.string().min(1) });

export async function apiTokenRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  app.get("/api-tokens", { preHandler: requireAuth }, async (request) =>
    z.array(apiTokenSchema).parse(
      apiTokenService.listApiTokens(db, request.user.id).map((row) => ({
        id: row.id,
        name: row.name,
        lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
    ),
  );

  app.post("/api-tokens", { preHandler: requireAuth }, async (request, reply) => {
    const body = createApiTokenRequestSchema.parse(request.body);
    const { id, token } = apiTokenService.createApiToken(db, request.user.id, body.name);
    return reply.status(201).send(apiTokenCreatedSchema.parse({ id, token }));
  });

  app.delete("/api-tokens/:id", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = tokenIdParamsSchema.parse(request.params);
    apiTokenService.revokeApiToken(db, request.user.id, id);
    return reply.status(204).send();
  });
}
