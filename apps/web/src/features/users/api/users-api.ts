import {
  type CreateUserRequest,
  type UserDto,
  createUserRequestSchema,
  userSchema,
} from "@grocery/shared";
import { z } from "zod";
import { api } from "../../../lib/api";

/** User management for admins (docs/API.md → Users; docs/TASKS.md → T32). */
export const usersApi = {
  /** GET /users → all users, oldest first (admin only, enforced server-side). */
  list: (signal?: AbortSignal): Promise<UserDto[]> =>
    api.get("/users", z.array(userSchema), signal),
  /** POST /users → 201 user (admin only; duplicate email → 409). */
  create: (request: CreateUserRequest): Promise<UserDto> =>
    api.post("/users", createUserRequestSchema.parse(request), userSchema),
  /** DELETE /users/:id → 204 (admin only; 409 while the user owns lists). */
  remove: (userId: string) => api.del(`/users/${userId}`),
};
