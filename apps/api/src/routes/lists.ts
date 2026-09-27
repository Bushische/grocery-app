import {
  addListMemberRequestSchema,
  createListRequestSchema,
  listDetailSchema,
  listMemberSchema,
  listSummarySchema,
  updateListMemberRequestSchema,
  updateListRequestSchema,
} from "@grocery/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../plugins/auth";
import { requireListRole } from "../plugins/list-auth";
import * as listService from "../services/listService";

const listIdParamsSchema = z.object({ id: z.string().min(1) });
const memberParamsSchema = z.object({ id: z.string().min(1), userId: z.string().min(1) });

export async function listRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  app.get("/lists", { preHandler: requireAuth }, async (request) =>
    listService.listListsForUser(db, request.user.id).map((list) => listSummarySchema.parse(list)),
  );

  app.post("/lists", { preHandler: requireAuth }, async (request, reply) => {
    const { title } = createListRequestSchema.parse(request.body);
    const summary = listService.createList(db, request.user.id, title);
    return reply.status(201).send(listSummarySchema.parse(summary));
  });

  app.get("/lists/:id", { preHandler: [requireAuth, requireListRole("VIEWER")] }, async (request) =>
    listDetailSchema.parse(
      listService.getListDetail(db, listIdParamsSchema.parse(request.params).id),
    ),
  );

  app.patch(
    "/lists/:id",
    { preHandler: [requireAuth, requireListRole("OWNER")] },
    async (request) => {
      const { id } = listIdParamsSchema.parse(request.params);
      const { title } = updateListRequestSchema.parse(request.body);
      listService.renameList(db, id, title);
      return listSummarySchema.parse({
        id,
        title,
        role: "OWNER",
        itemCounts: listService.getItemCounts(db, id),
      });
    },
  );

  app.delete(
    "/lists/:id",
    { preHandler: [requireAuth, requireListRole("OWNER")] },
    async (request, reply) => {
      listService.deleteList(db, listIdParamsSchema.parse(request.params).id);
      return reply.status(204).send();
    },
  );

  app.post(
    "/lists/:id/members",
    { preHandler: [requireAuth, requireListRole("OWNER")] },
    async (request, reply) => {
      const { id } = listIdParamsSchema.parse(request.params);
      const body = addListMemberRequestSchema.parse(request.body);
      const member = listService.addListMember(db, id, body.email, body.role);
      return reply.status(201).send(listMemberSchema.parse(member));
    },
  );

  app.patch(
    "/lists/:id/members/:userId",
    { preHandler: [requireAuth, requireListRole("OWNER")] },
    async (request) => {
      const { id, userId } = memberParamsSchema.parse(request.params);
      const { role } = updateListMemberRequestSchema.parse(request.body);
      return listMemberSchema.parse(listService.updateListMemberRole(db, id, userId, role));
    },
  );

  app.delete(
    "/lists/:id/members/:userId",
    { preHandler: [requireAuth, requireListRole("OWNER")] },
    async (request, reply) => {
      const { id, userId } = memberParamsSchema.parse(request.params);
      listService.removeListMember(db, id, userId);
      return reply.status(204).send();
    },
  );
}
