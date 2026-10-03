/** Bilingual open-app button label (inline buttons cap text at 64 chars). */
export const OPEN_APP_BUTTON_TEXT = "🛒 Открыть приложение · Open app";

/** Sends one chat message; `openAppUrl` attaches the Mini App `web_app` button. */
export type BotSender = (
  chatId: number,
  text: string,
  opts?: { openAppUrl?: string },
) => Promise<void>;

export type BotApiFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number }>;

/**
 * Builds the `sendMessage` payload (plain text — no `parse_mode`, so item
 * titles can never break formatting) with an optional inline `web_app`
 * button that opens the Mini App as a result.
 */
export function buildSendMessagePayload(
  chatId: number,
  text: string,
  openAppUrl?: string,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { chat_id: chatId, text };
  if (openAppUrl) {
    payload.reply_markup = {
      inline_keyboard: [[{ text: OPEN_APP_BUTTON_TEXT, web_app: { url: openAppUrl } }]],
    };
  }
  return payload;
}

/** Bot API sender over HTTPS (global fetch by default; injectable for tests). */
export function createBotSender(botToken: string, fetchImpl: BotApiFetch = fetch): BotSender {
  return async (chatId, text, opts) => {
    const response = await fetchImpl(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildSendMessagePayload(chatId, text, opts?.openAppUrl)),
    });
    if (!response.ok) {
      throw new Error(`Telegram sendMessage failed with status ${response.status}`);
    }
  };
}
