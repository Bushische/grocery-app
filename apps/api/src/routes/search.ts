import { searchResponseSchema, suggestResponseSchema, titleSchema } from "@grocery/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../plugins/auth";
import { requireMembership } from "../services/listService";
import * as searchService from "../services/searchService";

const suggestQuerySchema = z.object({ q: titleSchema, listId: z.string().min(1) });
const searchQuerySchema = z.object({
  q: titleSchema,
  listId: z.string().min(1).optional(),
});

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  app.get("/items/suggest", { preHandler: requireAuth }, async (request) => {
    const { q, listId } = suggestQuerySchema.parse(request.query);
    requireMembership(db, listId, request.user.id);
    return suggestResponseSchema.parse({ groups: searchService.suggestItems(db, listId, q) });
  });

  app.get("/search", { preHandler: requireAuth }, async (request) => {
    const { q, listId } = searchQuerySchema.parse(request.query);
    return searchResponseSchema.parse({
      results: searchService.searchItems(db, request.user.id, q, listId),
    });
  });
}
