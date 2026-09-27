import {
  categorySchema,
  createCategoryRequestSchema,
  itemsResponseSchema,
  updateCategoryRequestSchema,
} from "@grocery/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../plugins/auth";
import { requireCategoryRole, requireListRole } from "../plugins/list-auth";
import * as categoryService from "../services/categoryService";
import * as itemService from "../services/itemService";

const listIdParamsSchema = z.object({ id: z.string().min(1) });
const categoryIdParamsSchema = z.object({ id: z.string().min(1) });

export async function categoryRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  app.get(
    "/lists/:id/categories",
    { preHandler: [requireAuth, requireListRole("VIEWER")] },
    async (request) => {
      const { id } = listIdParamsSchema.parse(request.params);
      return categoryService
        .listCategories(db, id)
        .map((category) => categorySchema.parse(category));
    },
  );

  app.post(
    "/lists/:id/categories",
    { preHandler: [requireAuth, requireListRole("EDITOR")] },
    async (request, reply) => {
      const { id } = listIdParamsSchema.parse(request.params);
      const body = createCategoryRequestSchema.parse(request.body);
      const category = categoryService.createCategory(db, id, body.title, body.color);
      return reply.status(201).send(categorySchema.parse(category));
    },
  );

  app.patch(
    "/categories/:id",
    { preHandler: [requireAuth, requireCategoryRole("EDITOR")] },
    async (request) => {
      const { id } = categoryIdParamsSchema.parse(request.params);
      const patch = updateCategoryRequestSchema.parse(request.body);
      return categorySchema.parse(categoryService.updateCategory(db, id, patch));
    },
  );

  app.delete(
    "/categories/:id",
    { preHandler: [requireAuth, requireCategoryRole("OWNER")] },
    async (request, reply) => {
      const { id } = categoryIdParamsSchema.parse(request.params);
      categoryService.deleteCategory(db, id);
      return reply.status(204).send();
    },
  );

  app.get(
    "/categories/:id/items",
    { preHandler: [requireAuth, requireCategoryRole("VIEWER")] },
    async (request) => {
      const { id } = categoryIdParamsSchema.parse(request.params);
      return itemsResponseSchema.parse({ items: itemService.listItemsByCategory(db, id) });
    },
  );
}
