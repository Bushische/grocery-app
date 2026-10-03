// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../test/setup";
import { getTelegramInitData, getTelegramWebApp, notifyTelegramReady } from "./webapp";

function stubTelegram(webApp: unknown): void {
  (window as unknown as { Telegram?: unknown }).Telegram =
    webApp === undefined ? undefined : { WebApp: webApp };
}

afterEach(() => {
  (window as unknown as { Telegram?: unknown }).Telegram = undefined;
});

describe("telegram webapp bridge (T60)", () => {
  it("returns null outside Telegram (no bridge)", () => {
    stubTelegram(undefined);
    expect(getTelegramWebApp()).toBeNull();
    expect(getTelegramInitData()).toBeNull();
  });

  it("returns the signed initData inside Telegram", () => {
    stubTelegram({ initData: "auth_date=1&hash=abc", ready: vi.fn(), expand: vi.fn() });
    expect(getTelegramInitData()).toBe("auth_date=1&hash=abc");
  });

  it("treats an empty initData as absent (script loaded, plain browser)", () => {
    stubTelegram({ initData: "", ready: vi.fn(), expand: vi.fn() });
    expect(getTelegramInitData()).toBeNull();
  });

  it("handshakes with ready()+expand() inside Telegram, no-op outside", () => {
    const ready = vi.fn();
    const expand = vi.fn();
    stubTelegram({ initData: "x", ready, expand });
    notifyTelegramReady();
    expect(ready).toHaveBeenCalledOnce();
    expect(expand).toHaveBeenCalledOnce();

    stubTelegram(undefined);
    expect(() => notifyTelegramReady()).not.toThrow();
  });

  it("never throws when the bridge is partially implemented", () => {
    stubTelegram({
      initData: "x",
      ready: () => {
        throw new Error("old client");
      },
      expand: () => {
        throw new Error("old client");
      },
    });
    expect(() => notifyTelegramReady()).not.toThrow();
  });
});
