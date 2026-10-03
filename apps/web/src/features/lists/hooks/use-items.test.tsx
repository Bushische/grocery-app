// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiFetchMock, json } from "../../../test/mock-api";
import "../../../test/setup";
import { LIVE_REFRESH_INTERVAL_MS, useItems } from "./use-items";

const ITEMS = { items: [] };

function wrapper(queryClient: QueryClient): ({ children }: { children: ReactNode }) => ReactNode {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useItems live refresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it(`refetches every ${LIVE_REFRESH_INTERVAL_MS}ms so other devices' adds appear`, async () => {
    expect(LIVE_REFRESH_INTERVAL_MS).toBe(15_000);
    const mock = createApiFetchMock();
    mock.on("GET", "/api/lists/l1/items", () => json(200, ITEMS));
    mock.stub();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useItems("l1"), { wrapper: wrapper(queryClient) });

    // Flush mount effects + the initial fetch (no waitFor: fake timers own the clock).
    await vi.advanceTimersByTimeAsync(0);
    expect(mock.callsTo("GET", "/api/lists/l1/items")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS);
    expect(mock.callsTo("GET", "/api/lists/l1/items")).toHaveLength(2);
  });
});
