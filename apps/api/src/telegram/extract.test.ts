import { describe, expect, it, vi } from "vitest";
import { DeterministicExtractor, JevExtractor } from "./extract";
import type { JevFetch } from "./extract";

function jevOk(
  choice: string,
  confidence = 0.9,
): { ok: true; status: 200; json: () => Promise<unknown> } {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      id: "gen-dec-1",
      model: "typesafe/jev-1.13-20260917",
      answers: { action: { type: "choice", choice, confidence, probabilities: {} } },
      usage: { input_tokens: 100, output_tokens: 10, cost: 0.0000042 },
    }),
  };
}

type StubResponse = { ok: boolean; status: number; json: () => Promise<unknown> };

function stubFetch(handler: () => StubResponse): JevFetch {
  return (async () => handler()) as JevFetch;
}

describe("DeterministicExtractor (T66 seam parity)", () => {
  const extractor = new DeterministicExtractor();

  it("classifies known intents with full confidence", async () => {
    await expect(extractor.extractAction("buy milk")).resolves.toEqual({
      action: "add",
      confidence: 1,
    });
    await expect(extractor.extractAction("что купить")).resolves.toEqual({
      action: "list",
      confidence: 1,
    });
  });

  it("marks unknown text with zero confidence", async () => {
    await expect(extractor.extractAction("well hello there")).resolves.toEqual({
      action: "unknown",
      confidence: 0,
    });
  });
});

describe("JevExtractor Decisions client (T66)", () => {
  it("posts state+choice-question and maps the verdict", async () => {
    const fetchImpl = vi.fn(async () => jevOk("buy", 0.82));
    const extractor = new JevExtractor({
      apiKey: "key",
      model: "typesafe/jev-1.13",
      timeoutMs: 1000,
      fetchImpl: fetchImpl as unknown as JevFetch,
    });

    await expect(extractor.extractAction("something for breakfast")).resolves.toEqual({
      action: "buy",
      confidence: 0.82,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe("https://openrouter.ai/api/alpha/decisions");
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body).toMatchObject({ model: "typesafe/jev-1.13" });
    expect(body).toHaveProperty("state");
    expect(body).toHaveProperty("questions");
  });

  it("degrades to unknown on non-ok, schema drift, unknown labels, and throws", async () => {
    const cases: Array<{ name: string; fetchImpl: JevFetch }> = [
      {
        name: "non-ok",
        fetchImpl: stubFetch(() => ({ ok: false, status: 429, json: async () => ({}) })),
      },
      {
        name: "schema drift",
        fetchImpl: stubFetch(() => ({ ok: true, status: 200, json: async () => ({ nope: 1 }) })),
      },
      {
        name: "unknown label",
        fetchImpl: stubFetch(() => jevOk("teleport", 0.99)),
      },
      {
        name: "throw",
        fetchImpl: async () => {
          throw new Error("boom");
        },
      },
    ];
    for (const { name, fetchImpl } of cases) {
      const extractor = new JevExtractor({
        apiKey: "key",
        model: "typesafe/jev-1.13",
        timeoutMs: 1000,
        fetchImpl,
      });
      await expect(extractor.extractAction("hello"), `${name}`).resolves.toEqual({
        action: "unknown",
        confidence: 0,
      });
    }
  });

  it("treats missing confidence as zero", async () => {
    const fetchImpl = stubFetch(() => ({
      ok: true,
      status: 200,
      json: async () => ({ answers: { action: { type: "choice", choice: "list" } } }),
    }));
    const extractor = new JevExtractor({
      apiKey: "key",
      model: "typesafe/jev-1.13",
      timeoutMs: 1000,
      fetchImpl,
    });
    await expect(extractor.extractAction("hello")).resolves.toEqual({
      action: "list",
      confidence: 0,
    });
  });

  it("aborts past the timeout (slow JEV never stalls the webhook)", async () => {
    const hanging: JevFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const extractor = new JevExtractor({
      apiKey: "key",
      model: "typesafe/jev-1.13",
      timeoutMs: 20,
      fetchImpl: hanging,
    });
    await expect(extractor.extractAction("hello")).resolves.toEqual({
      action: "unknown",
      confidence: 0,
    });
  }, 5000);
});
