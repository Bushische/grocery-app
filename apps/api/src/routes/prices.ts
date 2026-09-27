import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  createPriceObservationRequestSchema,
  priceObservationSchema,
  pricesResponseSchema,
} from "@grocery/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../plugins/auth";
import { requireItemRole } from "../plugins/list-auth";
import * as priceService from "../services/priceService";

const itemIdParamsSchema = z.object({ id: z.string().min(1) });

/** `?cursor=&limit=` (docs/API.md → Conventions: default 50, max 100). */
const listPricesQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).optional(),
});

export async function priceRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  app.post(
    "/items/:id/prices",
    { preHandler: [requireAuth, requireItemRole("EDITOR")] },
    async (request, reply) => {
      const { id } = itemIdParamsSchema.parse(request.params);
      const body = createPriceObservationRequestSchema.parse(request.body);
      const observation = priceService.createPriceObservation(db, id, body);
      return reply.status(201).send(priceObservationSchema.parse(observation));
    },
  );

  app.get(
    "/items/:id/prices",
    { preHandler: [requireAuth, requireItemRole("VIEWER")] },
    async (request) => {
      const { id } = itemIdParamsSchema.parse(request.params);
      const { cursor, limit } = listPricesQuerySchema.parse(request.query);
      return pricesResponseSchema.parse(
        priceService.listPriceObservations(db, id, {
          cursor,
          limit: limit ?? DEFAULT_PAGE_LIMIT,
        }),
      );
    },
  );
}
