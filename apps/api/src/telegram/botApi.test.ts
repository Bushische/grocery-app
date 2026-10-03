import { describe, expect, it, vi } from "vitest";
import { OPEN_APP_BUTTON_TEXT, buildSendMessagePayload, createBotSender } from "./botApi";

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
