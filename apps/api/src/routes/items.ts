import {
  MAX_IMAGE_UPLOAD_BYTES,
  createItemRequestSchema,
  itemDetailSchema,
  itemImageResponseSchema,
  itemSchema,
  itemStatusByFilter,
  itemStatusFilterSchema,
  itemsResponseSchema,
  moveItemRequestSchema,
  reorderRequestSchema,
  smartAddRequestSchema,
  smartAddResponseSchema,
  updateItemRequestSchema,
} from "@grocery/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { FastifyHttpError } from "../errors";
import { requireAuth } from "../plugins/auth";
import { requireItemRole, requireListRole } from "../plugins/list-auth";
import * as imageService from "../services/imageService";
import * as itemService from "../services/itemService";

const listIdParamsSchema = z.object({ id: z.string().min(1) });
const itemIdParamsSchema = z.object({ id: z.string().min(1) });

/** Multipart framing overhead on top of the 2 MB file limit. */
const IMAGE_BODY_LIMIT = MAX_IMAGE_UPLOAD_BYTES + 64 * 1024;

/** Matches the @fastify/multipart file-size error (mapped to 400 per T10 DoD). */
function isFileTooLarge(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "FST_REQ_FILE_TOO_LARGE"
  );
}

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

  app.post(
    "/lists/:id/items/reorder",
    { preHandler: [requireAuth, requireListRole("EDITOR")] },
    async (request, reply) => {
      const { id } = listIdParamsSchema.parse(request.params);
      const { status, orderedIds } = reorderRequestSchema.parse(request.body);
      itemService.reorderItems(db, id, status, orderedIds);
      return reply.status(204).send();
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

  app.post(
    "/items/:id/move",
    { preHandler: [requireAuth, requireItemRole("EDITOR")] },
    async (request) => {
      const { id } = itemIdParamsSchema.parse(request.params);
      const { status } = moveItemRequestSchema.parse(request.body);
      return itemSchema.parse(itemService.moveItem(db, id, itemStatusByFilter[status]));
    },
  );

  app.post(
    "/items/:id/image",
    {
      preHandler: [requireAuth, requireItemRole("EDITOR")],
      // The multipart body includes framing around the file, so it may exceed
      // the 2 MB file limit; the app-wide 1 MiB default would reject valid
      // uploads before multipart sees them.
      bodyLimit: IMAGE_BODY_LIMIT,
    },
    async (request) => {
      const { id } = itemIdParamsSchema.parse(request.params);
      if (!request.isMultipart()) {
        throw new FastifyHttpError(400, "VALIDATION_ERROR", "Expected a multipart/form-data body");
      }
      let bytes: Buffer;
      try {
        const file = await request.file();
        if (!file) {
          throw new FastifyHttpError(400, "VALIDATION_ERROR", "Missing image file field");
        }
        bytes = await file.toBuffer();
      } catch (error) {
        if (error instanceof FastifyHttpError) {
          throw error;
        }
        if (isFileTooLarge(error)) {
          throw new FastifyHttpError(
            400,
            "VALIDATION_ERROR",
            `Image exceeds the ${MAX_IMAGE_UPLOAD_BYTES} byte upload limit`,
          );
        }
        throw error;
      }
      const imageFilename = await imageService.saveItemImage(db, id, app.uploadsRoot, bytes);
      return itemImageResponseSchema.parse({ imageFilename });
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
