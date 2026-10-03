import type { LoginRequest } from "@grocery/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../lib/api";
import { setSessionCache } from "../../auth/hooks/use-session";
import { getTelegramInitData } from "../webapp";

/**
 * One-time Telegram link (docs/TELEGRAM_PLAN.md → §2): the same email+password
 * fields as the normal login, plus the signed `initData` read at submit time.
 * Success stores the standard session — later boots use the passwordless
 * Telegram session instead.
 */
export function useTelegramLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginRequest) => {
      const initData = getTelegramInitData();
      if (!initData) {
        throw new Error("Telegram is not available");
      }
      return api.telegramLink(input.email, input.password, initData);
    },
    onSuccess: (user) => setSessionCache(queryClient, user),
  });
}
