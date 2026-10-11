import type { Category, Item } from "@grocery/shared";
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import "../../../test/setup";
import { useAuthStore } from "../../../stores/auth-store";
import { createApiFetchMock, json } from "../../../test/mock-api";
import { useCategories } from "../../lists/hooks/use-categories";
import {
  patchCategoryInList,
  patchItemsCategory,
  removeCategoryFromList,
  reorderCategoriesInList,
  useReorderCategories,
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

describe("reorderCategoriesInList (T94, pure)", () => {
  it("applies the persisted order with sortOrder = index", () => {
    expect(reorderCategoriesInList([DAIRY, BAKERY], ["c2", "c1"])).toEqual([
      { ...BAKERY, sortOrder: 0 },
      { ...DAIRY, sortOrder: 1 },
    ]);
  });

  it("ignores unknown ids and appends rows missing from the order at the end", () => {
    expect(reorderCategoriesInList([DAIRY, BAKERY], ["c2", "zzz"])).toEqual([
      { ...BAKERY, sortOrder: 0 },
      DAIRY,
    ]);
  });
});

interface ReorderWorld {
  categories: Category[];
}

function initialReorderWorld(): ReorderWorld {
  return { categories: [DAIRY, BAKERY] };
}

/** Harness mounting the categories query next to the reorder mutation. */
function ReorderHarness() {
  const query = useCategories("l1");
  const reorder = useReorderCategories("l1");
  return (
    <div>
      <output data-testid="category-order">{(query.data ?? []).map((c) => c.id).join(",")}</output>
      <button type="button" onClick={() => reorder.mutate(["c2", "c1"])}>
        reorder
      </button>
    </div>
  );
}

function stubReorderWorld(mock: ReturnType<typeof createApiFetchMock>, world: ReorderWorld): void {
  mock.on("GET", "/api/lists/l1/categories", () => json(200, world.categories));
  mock.on("GET", "/api/lists/l1/items", () => json(200, { items: [] }));
  mock.on("POST", "/api/lists/l1/categories/reorder", ({ body }) => {
    const { orderedIds } = body as { orderedIds: string[] };
    world.categories = orderedIds.map((id, index) => ({
      ...world.categories.find((category) => category.id === id)!,
      sortOrder: index,
    }));
    return json(204);
  });
}

function renderReorderHarness(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ReorderHarness />
    </QueryClientProvider>,
  );
}

describe("useReorderCategories (T94)", () => {
  it("flips the order on screen, POSTs orderedIds, and the refetch returns the new sortOrder", async () => {
    useAuthStore.setState({ accessToken: "t", user: { id: "u1", email: "a@b.co", role: "user" } });
    const mock = createApiFetchMock();
    const world = initialReorderWorld();
    stubReorderWorld(mock, world);
    mock.stub();
    renderReorderHarness();

    await waitFor(() => expect(screen.getByTestId("category-order")).toHaveTextContent("c1,c2"));
    await userEvent.setup().click(screen.getByRole("button", { name: "reorder" }));

    expect(mock.callsTo("POST", "/api/lists/l1/categories/reorder")[0]?.body).toEqual({
      orderedIds: ["c2", "c1"],
    });
    // Optimistic flip lands before the refetch; the refetch then confirms it.
    await waitFor(() => expect(screen.getByTestId("category-order")).toHaveTextContent("c2,c1"));
    expect(world.categories.map((category) => category.title)).toEqual(["Bakery", "Dairy"]);
    expect(world.categories.map((category) => category.sortOrder)).toEqual([0, 1]);
    expect(mock.callsTo("GET", "/api/lists/l1/categories").length).toBeGreaterThan(1);
  });

  it("restores the previous order when the reorder fails", async () => {
    useAuthStore.setState({ accessToken: "t", user: { id: "u1", email: "a@b.co", role: "user" } });
    const mock = createApiFetchMock();
    mock.on("GET", "/api/lists/l1/categories", () => json(200, [DAIRY, BAKERY]));
    mock.on("GET", "/api/lists/l1/items", () => json(200, { items: [] }));
    mock.on("POST", "/api/lists/l1/categories/reorder", () =>
      json(500, { error: { code: "INTERNAL_ERROR", message: "boom" } }),
    );
    mock.stub();
    renderReorderHarness();

    await waitFor(() => expect(screen.getByTestId("category-order")).toHaveTextContent("c1,c2"));
    await userEvent.setup().click(screen.getByRole("button", { name: "reorder" }));

    await waitFor(() =>
      expect(mock.callsTo("POST", "/api/lists/l1/categories/reorder")).toHaveLength(1),
    );
    // Rollback + refetch settle back on the original order.
    await waitFor(() => expect(screen.getByTestId("category-order")).toHaveTextContent("c1,c2"));
  });

  it("invalidates the categories and items caches on settle (grouping + picker follow)", async () => {
    useAuthStore.setState({ accessToken: "t", user: { id: "u1", email: "a@b.co", role: "user" } });
    const mock = createApiFetchMock();
    mock.on("POST", "/api/lists/l1/categories/reorder", () => json(204));
    mock.stub();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useReorderCategories("l1"), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    });

    act(() => {
      result.current.mutate(["c2", "c1"]);
    });
    await waitFor(() =>
      expect(mock.callsTo("POST", "/api/lists/l1/categories/reorder")).toHaveLength(1),
    );
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["categories", "l1"] }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["items", "l1"] });
  });
});
