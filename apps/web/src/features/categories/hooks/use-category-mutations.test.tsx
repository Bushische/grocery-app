import type { Category, Item } from "@grocery/shared";
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import "../../../test/setup";
import {
  patchCategoryInList,
  patchItemsCategory,
  removeCategoryFromList,
  useUpdateCategory,
} from "./use-category-mutations";

const DAIRY: Category = {
  id: "c1",
  title: "Dairy",
  color: "#3B82F6",
  sortOrder: 0,
  itemCount: 2,
};
const BAKERY: Category = {
  id: "c2",
  title: "Bakery",
  color: "#F59E0B",
  sortOrder: 1,
  itemCount: 0,
};

const ADDED_AT = "2026-09-24T08:00:00.000Z";

function item(id: string, category: { id: string; title: string; color: string }): Item {
  return {
    id,
    title: `Item ${id}`,
    qtyText: null,
    status: "TO_BUY",
    sortOrder: 0,
    addedAt: ADDED_AT,
    daysInList: 3,
    category,
    imageFilename: null,
    currentPrice: null,
  };
}

describe("category cache helpers (docs/TASKS.md → T19, pure)", () => {
  it("patchCategoryInList merges only the patched fields into the matching row", () => {
    const updated = patchCategoryInList([DAIRY, BAKERY], "c1", { color: "#FF0000" });
    expect(updated[0]).toEqual({ ...DAIRY, color: "#FF0000" });
    expect(updated[1]).toBe(BAKERY);
    expect(patchCategoryInList([DAIRY], "zzz", { title: "X" })).toEqual([DAIRY]);
  });

  it("removeCategoryFromList drops only the matching row", () => {
    expect(removeCategoryFromList([DAIRY, BAKERY], "c2")).toEqual([DAIRY]);
    expect(removeCategoryFromList([DAIRY], "c2")).toEqual([DAIRY]);
  });

  it("patchItemsCategory re-colors only the items of the patched category", () => {
    const data = {
      items: [
        item("i1", { id: "c1", title: "Dairy", color: "#3B82F6" }),
        item("i2", { id: "c2", title: "Bakery", color: "#F59E0B" }),
        item("i3", { id: "c1", title: "Dairy", color: "#3B82F6" }),
      ],
    };
    const patched = patchItemsCategory(data, "c1", { color: "#FF0000", title: "Milch" });
    expect(patched.items[0]?.category).toEqual({ id: "c1", title: "Milch", color: "#FF0000" });
    expect(patched.items[1]?.category).toEqual({ id: "c2", title: "Bakery", color: "#F59E0B" });
    expect(patched.items[2]?.category).toEqual({ id: "c1", title: "Milch", color: "#FF0000" });
    // Item fields other than the embedded category stay untouched.
    expect(patched.items[0]).toEqual({ ...data.items[0], category: patched.items[0]?.category });
  });
});

/** Fetch double whose PATCH /api/categories/c1 answer is controlled by the test. */
function stubDeferredPatchFetch(): (response: Response) => void {
  let release: ((response: Response) => void) | null = null;
  const patchResponse = new Promise<Response>((resolve) => {
    release = resolve;
  });
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(String(input), "http://localhost");
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "PATCH" && url.pathname === "/api/categories/c1") return patchResponse;
      throw new Error(`Unexpected request: ${method} ${url.pathname}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return (response) => release?.(response);
}

function jsonResponse(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
  } as Response;
}

describe("useUpdateCategory (docs/TASKS.md → T19 optimistic caches)", () => {
  const CATEGORIES = [DAIRY, BAKERY];
  const ITEMS = {
    items: [
      item("i1", { id: "c1", title: "Dairy", color: "#3B82F6" }),
      item("i2", { id: "c2", title: "Bakery", color: "#F59E0B" }),
    ],
  };

  it("re-colors every cache that renders the category while the PATCH is in flight", async () => {
    stubDeferredPatchFetch();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(["categories", "l1"], CATEGORIES);
    queryClient.setQueryData(["items", "l1"], ITEMS);
    const { result } = renderHook(() => useUpdateCategory("l1"), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    });

    act(() => {
      result.current.mutate({ categoryId: "c1", patch: { color: "#FF0000" } });
    });
    // The PATCH never answers in this test, so the mutation stays pending while
    // onMutate's optimistic writes land.
    await waitFor(() =>
      expect(queryClient.getQueryData<Category[]>(["categories", "l1"])?.[0]?.color).toBe(
        "#FF0000",
      ),
    );
    expect(result.current.isPending).toBe(true);
    const itemsCache = queryClient.getQueryData<{ items: Item[] }>(["items", "l1"]);
    expect(itemsCache?.items.map((entry) => entry.category.color)).toEqual(["#FF0000", "#F59E0B"]);
  });

  it("rolls the caches back when the PATCH fails", async () => {
    const releasePatch = stubDeferredPatchFetch();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(["categories", "l1"], CATEGORIES);
    queryClient.setQueryData(["items", "l1"], ITEMS);
    const { result } = renderHook(() => useUpdateCategory("l1"), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    });

    act(() => {
      result.current.mutate({ categoryId: "c1", patch: { color: "#FF0000" } });
    });
    await waitFor(() =>
      expect(queryClient.getQueryData<Category[]>(["categories", "l1"])?.[0]?.color).toBe(
        "#FF0000",
      ),
    );
    expect(queryClient.getQueryData<Category[]>(["categories", "l1"])?.[0]?.color).toBe("#FF0000");

    act(() => {
      releasePatch(jsonResponse(500, { error: { code: "INTERNAL_ERROR", message: "boom" } }));
    });
    await waitFor(() => expect(result.current.isError).toBe(true));

    // The failed refetches leave the data alone, so the caches equal the snapshots.
    expect(queryClient.getQueryData(["categories", "l1"])).toEqual(CATEGORIES);
    expect(queryClient.getQueryData(["items", "l1"])).toEqual(ITEMS);
  });
});
