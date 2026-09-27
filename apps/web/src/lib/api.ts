import { authAdapter } from "../stores/auth-store";
import { createApiClient } from "./api-client";

/** App-wide API client wired to the in-memory auth store. */
export const api = createApiClient(authAdapter);
