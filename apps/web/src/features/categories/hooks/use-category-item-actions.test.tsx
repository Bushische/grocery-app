import type { Item, ListSummary } from "@grocery/shared";
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { createApiFetchMock, json } from "../../../test/mock-api";
import "../../../test/setup";
import { useItems } from "../../lists/hooks/use-items";
import { useLists } from "../../lists/hooks/use-lists";
import { useCreateCategoryItem, useReactivateCategoryItem } from "./use-category-item-actions";
import { useCategoryItems } from "./use-category-items";

const ADDED_AT = "2026-09-24T08:00:00.000Z";
const DAIRY = { id: "c1", title: "Dairy", color: "#3B82F6" };
const LISTS: ListSummary[] = [
  { id: "l1", title: "Weekly", role: "EDITOR", itemCounts: { toBuy: 1, bought: 0 } },
];

function item(partial: Partial<Item> & Pick<Item, "id" | "title" | "status">): Item {
  return {
    qtyText: null,
    sortOrder: 0,
    addedAt: ADDED_AT,
    daysInList: 0,
    category: DAIRY,
    imageFilename: null,
    currentPrice: null,
    ...partial,
  };
}

/**
 * Keeps an active observer on every cache the mutations must refresh — an
 * invalidated query without observers would never refetch in the test.
 */
function CacheProbe(): null {
  useCategoryItems("c1");
  useItems("l1");
  useLists();
  return null;
}

function renderActions<Result>(hook: () => Result, queryClient: QueryClient) {
  return renderHook(hook, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <CacheProbe />
        {children}
      </QueryClientProvider>
    ),
  });
}

describe("category item actions (docs/TASKS.md → T43 cache refresh)", () => {
  it("useCreateCategoryItem POSTs title+categoryId and refreshes category, list, and counts", async () => {
    const mock = createApiFetchMock();
    mock.on("GET", "/api/lists", () => json(200, LISTS));
    mock.on("GET", "/api/lists/l1/items", () => json(200, { items: [] }));
    mock.on("GET", "/api/categories/c1/items", () => json(200, { items: [] }));
    mock.on("POST", "/api/lists/l1/items", () =>
      json(201, item({ id: "i9", title: "Yogurt", status: "TO_BUY" })),
    );
    mock.stub();

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderActions(() => useCreateCategoryItem("l1", "c1"), queryClient);

    // Mount fetches every observed cache once.
    await waitFor(() => expect(mock.callsTo("GET", "/api/categories/c1/items")).toHaveLength(1));
    await waitFor(() => expect(mock.callsTo("GET", "/api/lists/l1/items")).toHaveLength(1));
    await waitFor(() => expect(mock.callsTo("GET", "/api/lists")).toHaveLength(1));

    act(() => {
      result.current.mutate("Yogurt");
    });

    await waitFor(() => expect(mock.callsTo("POST", "/api/lists/l1/items")).toHaveLength(1));
    expect(mock.callsTo("POST", "/api/lists/l1/items")[0]?.body).toEqual({
      title: "Yogurt",
      categoryId: "c1",
    });
    // All three caches refetch: this category view, the main screen, the counts.
    await waitFor(() => expect(mock.callsTo("GET", "/api/categories/c1/items")).toHaveLength(2));
    await waitFor(() => expect(mock.callsTo("GET", "/api/lists/l1/items")).toHaveLength(2));
    await waitFor(() => expect(mock.callsTo("GET", "/api/lists")).toHaveLength(2));
  });

  it("useReactivateCategoryItem moves the item to to_buy and refreshes the same caches", async () => {
    const mock = createApiFetchMock();
    mock.on("GET", "/api/lists", () => json(200, LISTS));
    mock.on("GET", "/api/lists/l1/items", () => json(200, { items: [] }));
    mock.on("GET", "/api/categories/c1/items", () => json(200, { items: [] }));
    mock.on("POST", "/api/items/i2/move", () =>
      json(200, item({ id: "i2", title: "Butter", status: "TO_BUY" })),
    );
    mock.stub();

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderActions(() => useReactivateCategoryItem("l1", "c1"), queryClient);

    await waitFor(() => expect(mock.callsTo("GET", "/api/categories/c1/items")).toHaveLength(1));
    await waitFor(() => expect(mock.callsTo("GET", "/api/lists/l1/items")).toHaveLength(1));
    await waitFor(() => expect(mock.callsTo("GET", "/api/lists")).toHaveLength(1));

    act(() => {
      result.current.mutate("i2");
    });

    await waitFor(() => expect(mock.callsTo("POST", "/api/items/i2/move")).toHaveLength(1));
    expect(mock.callsTo("POST", "/api/items/i2/move")[0]?.body).toEqual({ status: "to_buy" });
    await waitFor(() => expect(mock.callsTo("GET", "/api/categories/c1/items")).toHaveLength(2));
    await waitFor(() => expect(mock.callsTo("GET", "/api/lists/l1/items")).toHaveLength(2));
    await waitFor(() => expect(mock.callsTo("GET", "/api/lists")).toHaveLength(2));
  });
});
