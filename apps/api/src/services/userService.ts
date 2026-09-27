import type { CreateUserRequest, UserDto } from "@grocery/shared";
import { createId } from "@paralleldrive/cuid2";
import bcrypt from "bcryptjs";
import { asc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { groceryLists, users } from "../db/schema";
import { FastifyHttpError } from "../errors";

export type UserRow = typeof users.$inferSelect;

/** Serializes a user row per docs/API.md → Users (ISO 8601 timestamps, no hash). */
export function toUserDto(user: UserRow): UserDto {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  };
}

/** Lists all users (admin only), oldest first, email as the tiebreaker. */
export function listUsers(db: Db): UserRow[] {
  return db.select().from(users).orderBy(asc(users.createdAt), asc(users.email)).all();
}

/**
 * Creates a user with a bcrypt-hashed password (docs/API.md → Users); only
 * the hash is ever persisted. Duplicate email (emails are normalized by the
 * shared schema) → 409 CONFLICT.
 */
export async function createUser(db: Db, input: CreateUserRequest): Promise<UserRow> {
  const existing = db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, input.email))
    .get();
  if (existing) {
    throw new FastifyHttpError(409, "CONFLICT", `A user with email ${input.email} already exists`);
  }
  return db
    .insert(users)
    .values({
      id: createId(),
      email: input.email,
      passwordHash: await bcrypt.hash(input.password, 10),
      role: input.role,
    })
    .returning()
    .get();
}

/**
 * Deletes a user (docs/API.md → Users): 409 when the user still owns lists
 * (docs/DATA_MODEL.md keeps list ownership intact — the client must transfer
 * or delete the lists first); 404 for unknown ids. Memberships, refresh
 * tokens, and API tokens cascade via the schema's FKs.
 */
export function deleteUser(db: Db, userId: string): void {
  const ownsList = db
    .select({ id: groceryLists.id })
    .from(groceryLists)
    .where(eq(groceryLists.ownerId, userId))
    .get();
  if (ownsList) {
    throw new FastifyHttpError(409, "CONFLICT", "The user owns lists and cannot be deleted");
  }
  const result = db.delete(users).where(eq(users.id, userId)).run();
  if (result.changes === 0) {
    throw new FastifyHttpError(404, "NOT_FOUND", `User ${userId} not found`);
  }
}
