/** Bilingual open-app button label (inline buttons cap text at 64 chars). */
export const OPEN_APP_BUTTON_TEXT = "🛒 Открыть приложение · Open app";

/** Prefix for tap-to-select list buttons (T70): `tg-use:<listId>`. */
export const LIST_CHOICE_PREFIX = "tg-use:";

/** One tap-to-select row: the visible title plus the list it stores. */
export type ListChoice = { listId: string; title: string };

/** Sends one chat message; `openAppUrl` attaches the Mini App `web_app` button. */
export type BotSender = (
  chatId: number,
  text: string,
  opts?: { openAppUrl?: string; choices?: ListChoice[] },
) => Promise<void>;

export type BotApiFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number }>;

/**
 * Builds the `sendMessage` payload (plain text — no `parse_mode`, so item
 * titles can never break formatting) with an optional inline `web_app`
 * button that opens the Mini App as a result, plus optional tap-to-select
 * list buttons (one row per list, `callback_data = tg-use:<listId>`).
 */
export function buildSendMessagePayload(
  chatId: number,
  text: string,
  openAppUrl?: string,
  choices: ListChoice[] = [],
): Record<string, unknown> {
  const payload: Record<string, unknown> = { chat_id: chatId, text };
  const keyboard: unknown[][] = [];
  for (const choice of choices) {
    // Button text caps at 64 chars — truncate long titles defensively.
    const label = choice.title.length > 60 ? `${choice.title.slice(0, 59)}…` : choice.title;
    keyboard.push([{ text: label, callback_data: `${LIST_CHOICE_PREFIX}${choice.listId}` }]);
  }
  if (openAppUrl) {
    keyboard.push([{ text: OPEN_APP_BUTTON_TEXT, web_app: { url: openAppUrl } }]);
  }
  if (keyboard.length > 0) {
    payload.reply_markup = { inline_keyboard: keyboard };
  }
  return payload;
}

/** Bot API sender over HTTPS (global fetch by default; injectable for tests). */
export function createBotSender(botToken: string, fetchImpl: BotApiFetch = fetch): BotSender {
  return async (chatId, text, opts) => {
    const response = await fetchImpl(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        buildSendMessagePayload(chatId, text, opts?.openAppUrl, opts?.choices ?? []),
      ),
    });
    if (!response.ok) {
      throw new Error(`Telegram sendMessage failed with status ${response.status}`);
    }
  };
}

/** Dismisses a callback-query spinner (never throws — the webhook still acks). */
export function createCallbackAnswerer(
  botToken: string,
  fetchImpl: BotApiFetch = fetch,
): (callbackQueryId: string) => Promise<void> {
  return async (callbackQueryId) => {
    try {
      await fetchImpl(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ callback_query_id: callbackQueryId }),
      });
    } catch {
      // The update is acked regardless — a stuck spinner beats a retry storm.
    }
  };
}
