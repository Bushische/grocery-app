import {
  type AddListMemberRequest,
  type ListDetail,
  type ListMember,
  type UpdateListMemberRequest,
  addListMemberRequestSchema,
  listDetailSchema,
  listMemberSchema,
  updateListMemberRequestSchema,
} from "@grocery/shared";
import { api } from "../../../lib/api";

/** List detail + member management (docs/API.md → Lists — members). */
export const membersApi = {
  /** GET /lists/:id — title, owner, and members (any member may read). */
  detail: (listId: string, signal?: AbortSignal): Promise<ListDetail> =>
    api.get(`/lists/${listId}`, listDetailSchema, signal),
  /** POST /lists/:id/members → 201 member (OWNER only, enforced server-side). */
  add: (listId: string, request: AddListMemberRequest): Promise<ListMember> =>
    api.post(
      `/lists/${listId}/members`,
      addListMemberRequestSchema.parse(request),
      listMemberSchema,
    ),
  /** PATCH /lists/:id/members/:userId → 200 member (OWNER only). */
  updateRole: (
    listId: string,
    userId: string,
    request: UpdateListMemberRequest,
  ): Promise<ListMember> =>
    api.patch(
      `/lists/${listId}/members/${userId}`,
      updateListMemberRequestSchema.parse(request),
      listMemberSchema,
    ),
  /** DELETE /lists/:id/members/:userId → 204 (OWNER only). */
  remove: (listId: string, userId: string) => api.del(`/lists/${listId}/members/${userId}`),
};
