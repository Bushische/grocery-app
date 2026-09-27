import { listSummarySchema } from "@grocery/shared";
import { api } from "../../../lib/api";

/** GET /lists (docs/API.md → Lists) — the signed-in user's lists with role and item counts. */
export const listsApi = {
  list: (signal?: AbortSignal) => api.get("/lists", listSummarySchema.array(), signal),
};
