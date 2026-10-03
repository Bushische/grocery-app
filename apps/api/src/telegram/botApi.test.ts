import { describe, expect, it, vi } from "vitest";
import {
  LIST_CHOICE_PREFIX,
  OPEN_APP_BUTTON_TEXT,
  buildSendMessagePayload,
  createBotSender,
  createCallbackAnswerer,
} from "./botApi";

describe("buildSendMessagePayload (T62)", () => {
  it("builds a plain-text payload without a keyboard by default", () => {
    expect(buildSendMessagePayload(42, "hello")).toEqual({ chat_id: 42, text: "hello" });
  });

  it("attaches the open-app web_app button when a URL is given", () => {
    expect(buildSendMessagePayload(42, "hello", "https://grocery.example.com/")).toEqual({
      chat_id: 42,
      text: "hello",
      reply_markup: {
        inline_keyboard: [
          [{ text: OPEN_APP_BUTTON_TEXT, web_app: { url: "https://grocery.example.com/" } }],
        ],
      },
    });
  });

  it("renders one tap-to-select row per choice above the open-app button (T70)", () => {
    expect(
      buildSendMessagePayload(42, "pick one", "https://grocery.example.com/", [
        { listId: "a", title: "Home" },
        { listId: "b", title: "Dacha" },
      ]),
    ).toEqual({
      chat_id: 42,
      text: "pick one",
      reply_markup: {
        inline_keyboard: [
          [{ text: "Home", callback_data: `${LIST_CHOICE_PREFIX}a` }],
          [{ text: "Dacha", callback_data: `${LIST_CHOICE_PREFIX}b` }],
          [{ text: OPEN_APP_BUTTON_TEXT, web_app: { url: "https://grocery.example.com/" } }],
        ],
      },
    });
  });

  it("truncates overlong titles to the 64-char button cap (T70)", () => {
    const payload = buildSendMessagePayload(42, "pick", undefined, [
      { listId: "a", title: "x".repeat(70) },
    ]);
    const row = (payload.reply_markup as { inline_keyboard: { text: string }[][] })
      .inline_keyboard[0]?.[0];
    expect(row?.text.length).toBeLessThanOrEqual(64);
  });
});

describe("createBotSender (T62)", () => {
  it("posts to the Bot API sendMessage endpoint", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 }));
    const sender = createBotSender("TOKEN", fetchImpl);
    await sender(7, "hi", { openAppUrl: "https://grocery.example.com/" });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const first = fetchImpl.mock.calls[0];
    if (!first) throw new Error("expected one sendMessage call");
    const [url, init] = first as unknown as [string, { body: string }];
    expect(url).toBe("https://api.telegram.org/botTOKEN/sendMessage");
    expect(JSON.parse(init.body)).toEqual({
      chat_id: 7,
      text: "hi",
      reply_markup: {
        inline_keyboard: [
          [{ text: OPEN_APP_BUTTON_TEXT, web_app: { url: "https://grocery.example.com/" } }],
        ],
      },
    });
  });

  it("throws on a non-2xx Bot API response (the webhook logs and still acks)", async () => {
    const sender = createBotSender("TOKEN", async () => ({ ok: false, status: 429 }));
    await expect(sender(7, "hi")).rejects.toThrow(/status 429/);
  });
});

describe("createCallbackAnswerer (T70)", () => {
  it("posts the query id to answerCallbackQuery", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 }));
    await createCallbackAnswerer("TOKEN", fetchImpl)("cq-9");
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe("https://api.telegram.org/botTOKEN/answerCallbackQuery");
    expect(JSON.parse(init.body)).toEqual({ callback_query_id: "cq-9" });
  });

  it("never throws — a stuck spinner beats a retry storm", async () => {
    const answer = createCallbackAnswerer("TOKEN", async () => {
      throw new Error("net down");
    });
    await expect(answer("cq-9")).resolves.toBeUndefined();
  });
});
