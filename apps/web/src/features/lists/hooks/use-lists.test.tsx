import type { ListDetail, ListSummary } from "@grocery/shared";
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { listDetailQueryKey } from "../../members/hooks/use-list-detail";
import {
  LISTS_QUERY_KEY,
  renameListInDetail,
  renameListInSummaries,
  useUpdateList,
} from "./use-lists";
import "../../../test/setup";

const LISTS: ListSummary[] = [
  { id: "l1", title: "Weekly", role: "OWNER", itemCounts: { toBuy: 2, bought: 1 } },
  { id: "l2", title: "Party", role: "EDITOR", itemCounts: { toBuy: 0, bought: 0 } },
];
const DETAIL: ListDetail = {
  id: "l1",
  title: "Weekly",
  owner: { id: "u1", email: "alex@example.com" },
  members: [],
};

describe("renameListInSummaries / renameListInDetail (pure helpers)", () => {
  it("renames only the matching summary row", () => {
    const renamed = renameListInSummaries(LISTS, "l1", "Week");
    expect(renamed).toEqual([
      { id: "l1", title: "Week", role: "OWNER", itemCounts: { toBuy: 2, bought: 1 } },
      LISTS[1],
    ]);
    // Untouched rows keep their identity.
    expect(renamed[1]).toBe(LISTS[1]);
  });

  it("renames the cached detail title", () => {
    expect(renameListInDetail(DETAIL, "Week")).toEqual({ ...DETAIL, title: "Week" });
    expect(DETAIL.title).toBe("Weekly");
  });
});

function fakeResponse(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "OK",
    headers: new Headers(),
    json: async () => body,
  } as Response;
}

interface DeferredRenameResult {
  queryClient: QueryClient;
  patchBodies: unknown[];
  resolvers: Array<(response: Response) => void>;
}

/**
 * Seeds both caches the menu/page read, renders a one-click rename harness,
 * and holds the PATCH response back so optimistic updates can be asserted.
 */
function renderDeferredRenameHarness(): DeferredRenameResult {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(LISTS_QUERY_KEY, LISTS);
  queryClient.setQueryData(listDetailQueryKey("l1"), DETAIL);

  const patchBodies: unknown[] = [];
  const resolvers: Array<(response: Response) => void> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(String(input), "http://localhost");
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "PATCH" && url.pathname === "/api/lists/l1") {
        patchBodies.push(JSON.parse(String(init?.body)));
        return new Promise<Response>((resolve) => resolvers.push(resolve));
      }
      throw new Error(`Unexpected request: ${method} ${url.pathname}`);
    }),
  );

  function RenameHarness() {
    const rename = useUpdateList();
    return (
      <button type="button" onClick={() => rename.mutate({ id: "l1", title: "  Week  " })}>
        rename
      </button>
    );
  }

  render(
    <QueryClientProvider client={queryClient}>
      <RenameHarness />
    </QueryClientProvider>,
  );

  return { queryClient, patchBodies, resolvers };
}

describe("useUpdateList (docs/TASKS.md → T40 optimistic rename)", () => {
  it("optimistically renames both caches, then reconciles from the PATCH response — no refetch", async () => {
    const { queryClient, patchBodies, resolvers } = renderDeferredRenameHarness();

    fireEvent.click(screen.getByRole("button", { name: "rename" }));

    await waitFor(() => expect(patchBodies).toHaveLength(1));
    // The API layer trims via the shared schema (trim rules identical to create).
    expect(patchBodies[0]).toEqual({ title: "Week" });
    // Optimistic frame: header/switcher source and the members detail moved first.
    expect(queryClient.getQueryData<ListSummary[]>(LISTS_QUERY_KEY)?.[0]?.title).toBe("Week");
    expect(queryClient.getQueryData<ListDetail>(listDetailQueryKey("l1"))?.title).toBe("Week");
    expect(resolvers).toHaveLength(1);

    // The server response reconciles the caches — the hook never issues a GET.
    const getCalls = vi
      .mocked(fetch)
      .mock.calls.filter(
        ([input]) => new URL(String(input), "http://localhost").pathname === "/api/lists",
      );
    resolvers[0]!(
      fakeResponse(200, {
        id: "l1",
        title: "Week",
        role: "OWNER",
        itemCounts: { toBuy: 9, bought: 9 },
      }),
    );
    await waitFor(() =>
      expect(queryClient.getQueryData<ListSummary[]>(LISTS_QUERY_KEY)?.[0]?.itemCounts).toEqual({
        toBuy: 9,
        bought: 9,
      }),
    );
    expect(queryClient.getQueryData<ListSummary[]>(LISTS_QUERY_KEY)?.[0]?.title).toBe("Week");
    expect(queryClient.getQueryData<ListDetail>(listDetailQueryKey("l1"))?.title).toBe("Week");
    expect(getCalls).toHaveLength(0);
  });

  it("rolls both caches back when the PATCH fails", async () => {
    const { queryClient, patchBodies, resolvers } = renderDeferredRenameHarness();

    fireEvent.click(screen.getByRole("button", { name: "rename" }));
    await waitFor(() => expect(patchBodies).toHaveLength(1));
    expect(queryClient.getQueryData<ListSummary[]>(LISTS_QUERY_KEY)?.[0]?.title).toBe("Week");

    resolvers[0]!(fakeResponse(500, { error: { code: "INTERNAL_ERROR", message: "boom" } }));

    await waitFor(() =>
      expect(queryClient.getQueryData<ListSummary[]>(LISTS_QUERY_KEY)?.[0]?.title).toBe("Weekly"),
    );
    expect(queryClient.getQueryData<ListDetail>(listDetailQueryKey("l1"))?.title).toBe("Weekly");
  });
});
