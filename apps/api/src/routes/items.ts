import {
  createItemRequestSchema,
  itemDetailSchema,
  itemSchema,
  itemStatusByFilter,
  itemStatusFilterSchema,
  itemsResponseSchema,
  smartAddRequestSchema,
  smartAddResponseSchema,
  updateItemRequestSchema,
} from "@grocery/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../plugins/auth";
import { requireItemRole, requireListRole } from "../plugins/list-auth";
import * as itemService from "../services/itemService";

const listIdParamsSchema = z.object({ id: z.string().min(1) });
const itemIdParamsSchema = z.object({ id: z.string().min(1) });

export async function itemRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  app.get(
    "/lists/:id/items",
    { preHandler: [requireAuth, requireListRole("VIEWER")] },
    async (request) => {
      const { id } = listIdParamsSchema.parse(request.params);
      const { status } = z
        .object({ status: itemStatusFilterSchema.optional() })
        .parse(request.query);
      return itemsResponseSchema.parse({
        items: itemService.listItems(db, id, status ? itemStatusByFilter[status] : undefined),
      });
    },
  );

  app.post(
    "/lists/:id/items",
    { preHandler: [requireAuth, requireListRole("EDITOR")] },
    async (request, reply) => {
      const { id } = listIdParamsSchema.parse(request.params);
      const body = createItemRequestSchema.parse(request.body);
      const item = itemService.createItem(db, id, body);
      return reply.status(201).send(itemSchema.parse(item));
    },
  );

  app.post(
    "/lists/:id/items/smart-add",
    { preHandler: [requireAuth, requireListRole("EDITOR")] },
    async (request, reply) => {
      const { id } = listIdParamsSchema.parse(request.params);
      const { text } = smartAddRequestSchema.parse(request.body);
      const result = itemService.smartAddItem(db, id, text);
      return reply.status(result.created ? 201 : 200).send(smartAddResponseSchema.parse(result));
    },
  );

  app.get("/items/:id", { preHandler: [requireAuth, requireItemRole("VIEWER")] }, async (request) =>
    itemDetailSchema.parse(
      itemService.getItemDetail(db, itemIdParamsSchema.parse(request.params).id),
    ),
  );

  app.patch(
    "/items/:id",
    { preHandler: [requireAuth, requireItemRole("EDITOR")] },
    async (request) => {
      const { id } = itemIdParamsSchema.parse(request.params);
      const patch = updateItemRequestSchema.parse(request.body);
      return itemSchema.parse(itemService.updateItem(db, id, patch));
    },
  );

  app.delete(
    "/items/:id",
    { preHandler: [requireAuth, requireItemRole("EDITOR")] },
    async (request, reply) => {
      const { id } = itemIdParamsSchema.parse(request.params);
      itemService.deleteItem(db, id);
      return reply.status(204).send();
    },
  );
}
