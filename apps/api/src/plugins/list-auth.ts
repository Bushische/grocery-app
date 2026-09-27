import type { ListRole } from "@grocery/shared";
import type { preHandlerHookHandler } from "fastify";
import { z } from "zod";
import { FastifyHttpError } from "../errors";
import { requireMembership, roleRank } from "../services/listService";

/** All role-protected routes address the list as `:id` (…/members/:userId). */
const listIdParamsSchema = z.object({ id: z.string().min(1) });

declare module "fastify" {
  interface FastifyRequest {
    /** Set by requireListRole — the caller's membership role for `:id`. */
    listRole?: ListRole;
  }
}

/**
 * Middleware factory (docs/TASKS.md T6): requires an authenticated user who is
 * a member of the list addressed by `:id` with at least `minimum` role
 * (VIEWER < EDITOR < OWNER). Unknown list → 404; non-member or insufficient
 * role → 403. On success, `request.listRole` carries the caller's role.
 */
export function requireListRole(minimum: ListRole): preHandlerHookHandler {
  return async (request, _reply) => {
    const { id: listId } = listIdParamsSchema.parse(request.params);
    const role = requireMembership(request.server.db, listId, request.user.id);
    if (roleRank(role) < roleRank(minimum)) {
      throw new FastifyHttpError(403, "FORBIDDEN", `This action requires the ${minimum} role`);
    }
    request.listRole = role;
  };
}
