import type { AuthUser } from "@grocery/shared";
import { create } from "zustand";
import type { AuthAdapter } from "../lib/api-client";

interface AuthState {
  /** Access token kept in memory only — no persistence (docs/PROJECT.md → Auth). */
  accessToken: string | null;
  user: AuthUser | null;
}

export const useAuthStore = create<AuthState>()(() => ({
  accessToken: null,
  user: null,
}));

export const authAdapter: AuthAdapter = {
  getAccessToken: () => useAuthStore.getState().accessToken,
  setSession: (user, accessToken) => useAuthStore.setState({ user, accessToken }),
  clearSession: () => useAuthStore.setState({ user: null, accessToken: null }),
};
