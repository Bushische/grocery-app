import type { ListRole } from "@grocery/shared";
import { eq } from "drizzle-orm";
import type { preHandlerHookHandler } from "fastify";
import { z } from "zod";
import { categories, items } from "../db/schema";
import { FastifyHttpError } from "../errors";
import { requireMembership, roleRank } from "../services/listService";

/** Role-protected routes address either a list or a category as `:id`. */
const idParamsSchema = z.object({ id: z.string().min(1) });

declare module "fastify" {
  interface FastifyRequest {
    /** Set by requireListRole/requireCategoryRole — the caller's role for the resolved list. */
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
    const { id: listId } = idParamsSchema.parse(request.params);
    const role = requireMembership(request.server.db, listId, request.user.id);
    if (roleRank(role) < roleRank(minimum)) {
      throw new FastifyHttpError(403, "FORBIDDEN", `This action requires the ${minimum} role`);
    }
    request.listRole = role;
  };
}

/**
 * Same rules as requireListRole for routes addressing a *category* as `:id`
 * (docs/API.md → Categories): resolves the owning list first — unknown
 * category → 404, non-member or insufficient role → 403.
 */
export function requireCategoryRole(minimum: ListRole): preHandlerHookHandler {
  return async (request, _reply) => {
    const { id: categoryId } = idParamsSchema.parse(request.params);
    const category = request.server.db
      .select({ listId: categories.listId })
      .from(categories)
      .where(eq(categories.id, categoryId))
      .get();
    if (!category) {
      throw new FastifyHttpError(404, "NOT_FOUND", `Category ${categoryId} not found`);
    }
    const role = requireMembership(request.server.db, category.listId, request.user.id);
    if (roleRank(role) < roleRank(minimum)) {
      throw new FastifyHttpError(403, "FORBIDDEN", `This action requires the ${minimum} role`);
    }
    request.listRole = role;
  };
}

/**
 * Same rules for routes addressing an *item* as `:id` (docs/API.md → Items):
 * resolves the owning list first — unknown item → 404, non-member or
 * insufficient role → 403.
 */
export function requireItemRole(minimum: ListRole): preHandlerHookHandler {
  return async (request, _reply) => {
    const { id: itemId } = idParamsSchema.parse(request.params);
    const item = request.server.db
      .select({ listId: items.listId })
      .from(items)
      .where(eq(items.id, itemId))
      .get();
    if (!item) {
      throw new FastifyHttpError(404, "NOT_FOUND", `Item ${itemId} not found`);
    }
    const role = requireMembership(request.server.db, item.listId, request.user.id);
    if (roleRank(role) < roleRank(minimum)) {
      throw new FastifyHttpError(403, "FORBIDDEN", `This action requires the ${minimum} role`);
    }
    request.listRole = role;
  };
}
