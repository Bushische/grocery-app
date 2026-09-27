import { createUserRequestSchema, userSchema } from "@grocery/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin, requireAuth } from "../plugins/auth";
import * as userService from "../services/userService";

const userIdParamsSchema = z.object({ id: z.string().min(1) });

export async function userRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  app.get("/users", { preHandler: [requireAuth, requireAdmin] }, async () =>
    z.array(userSchema).parse(userService.listUsers(db).map(userService.toUserDto)),
  );

  app.post("/users", { preHandler: [requireAuth, requireAdmin] }, async (request, reply) => {
    const body = createUserRequestSchema.parse(request.body);
    const user = await userService.createUser(db, body);
    return reply.status(201).send(userSchema.parse(userService.toUserDto(user)));
  });

  app.delete("/users/:id", { preHandler: [requireAuth, requireAdmin] }, async (request, reply) => {
    const { id } = userIdParamsSchema.parse(request.params);
    userService.deleteUser(db, id);
    return reply.status(204).send();
  });
}
