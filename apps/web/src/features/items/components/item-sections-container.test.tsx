import type { Item } from "@grocery/shared";
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "../../../stores/auth-store";
import { createApiFetchMock, json } from "../../../test/mock-api";
import { useItems } from "../../lists/hooks/use-items";
import { useReorderItems } from "../hooks/use-item-mutations";
import { reorderedIdsAfterDrag } from "./item-sections";
import { ItemSectionsContainer } from "./item-sections-container";
import "../../../test/setup";

const CATEGORY = { id: "c1", title: "Other", color: "#6B7280" } as const;
const ADDED_AT = "2026-09-24T08:00:00.000Z";

function item(id: string, title: string, status: "TO_BUY" | "BOUGHT", sortOrder: number): Item {
  return {
    id,
    title,
    qtyText: id === "i1" ? "2x" : null,
    status,
    sortOrder,
    addedAt: ADDED_AT,
    daysInList: 3,
    category: CATEGORY,
    imageFilename: null,
    currentPrice: null,
  };
}

const TO_BUY = [item("i1", "Milk", "TO_BUY", 0), item("i2", "Bread", "TO_BUY", 1)];
const BOUGHT = [item("i3", "Butter", "BOUGHT", 0)];

function renderContainer(toBuy: Item[] = TO_BUY, bought: Item[] = BOUGHT, listId = "l1"): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route
            path="/"
            element={<ItemSectionsContainer listId={listId} toBuy={toBuy} bought={bought} />}
          />
          <Route path="/items/:itemId" element={<p>details-page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderReorderHarness(listId: string): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Harness() {
    const reorder = useReorderItems(listId);
    return (
      <button type="button" onClick={() => reorder.mutate(["i2", "i1"])}>
        trigger-reorder
      </button>
    );
  }
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Harness />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("reorderedIdsAfterDrag (T16 drag-end mapping, pure)", () => {
  it("moves the dragged item to the drop position", () => {
    expect(reorderedIdsAfterDrag(["a", "b", "c"], "a", "c")).toEqual(["b", "c", "a"]);
    expect(reorderedIdsAfterDrag(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
  });

  it("ignores drops outside the section or on the item itself", () => {
    expect(reorderedIdsAfterDrag(["a", "b"], "a", "a")).toBeNull();
    expect(reorderedIdsAfterDrag(["a", "b"], "a", "zzz")).toBeNull();
    expect(reorderedIdsAfterDrag(["a", "b"], "zzz", "b")).toBeNull();
  });
});

describe("useReorderItems (T16 reorder persistence)", () => {
  afterEach(() => {
    useAuthStore.setState({ accessToken: null, user: null });
  });

  it("POSTs the new order and rolls back on failure", async () => {
    useAuthStore.setState({ accessToken: "t", user: { id: "u1", email: "a@b.co", role: "user" } });
    let fail = true;
    const mock = createApiFetchMock();
    mock.on("POST", "/api/lists/l1/items/reorder", () =>
      fail ? json(500, { error: { code: "INTERNAL_ERROR", message: "boom" } }) : json(204),
    );
    mock.stub();
    renderReorderHarness("l1");

    await userEvent.setup().click(screen.getByRole("button", { name: "trigger-reorder" }));
    await waitFor(() =>
      expect(mock.callsTo("POST", "/api/lists/l1/items/reorder")[0]?.body).toEqual({
        status: "TO_BUY",
        orderedIds: ["i2", "i1"],
      }),
    );

    // Second call succeeds — the mutation recovers and persists the order.
    fail = false;
    await userEvent.setup().click(screen.getByRole("button", { name: "trigger-reorder" }));
    await waitFor(() =>
      expect(mock.callsTo("POST", "/api/lists/l1/items/reorder")).toHaveLength(2),
    );
  });
});

describe("ItemSectionsContainer (docs/TASKS.md → T16 main screen, T27 row-tap toggle)", () => {
  afterEach(() => {
    useAuthStore.setState({ accessToken: null, user: null });
    vi.useRealTimers();
  });

  it("renders the category color bar, title, quantity, days badge, and handle only on TO_BUY", () => {
    useAuthStore.setState({ accessToken: "t", user: { id: "u1", email: "a@b.co", role: "user" } });
    const mock = createApiFetchMock();
    mock.stub();
    renderContainer();

    const row = screen.getByTestId("item-row-i1");
    expect(row.querySelector("span[aria-hidden='true']")).toHaveStyle({
      "background-color": "rgb(107, 114, 128)",
    });
    expect(screen.getByText("Milk")).toBeInTheDocument();
    expect(screen.getByText("2x")).toBeInTheDocument();
    expect(screen.getByLabelText("Milk: 3 days in list")).toHaveTextContent("3d");
    expect(screen.getByTestId("handle-i1")).toBeInTheDocument();
    expect(screen.queryByTestId("handle-i3")).not.toBeInTheDocument();
  });

  it("toggles TO_BUY → BOUGHT when the row body is tapped (T27 DoD)", async () => {
    useAuthStore.setState({ accessToken: "t", user: { id: "u1", email: "a@b.co", role: "user" } });
    const mock = createApiFetchMock();
    mock.on("POST", "/api/items/i1/move", () => json(200, { ...TO_BUY[0]!, status: "BOUGHT" }));
    mock.stub();
    renderContainer();

    fireEvent.click(screen.getByRole("button", { name: "Mark Milk as bought" }));

    await waitFor(() => expect(mock.callsTo("POST", "/api/items/i1/move")).toHaveLength(1));
    expect(mock.callsTo("POST", "/api/items/i1/move")[0]?.body).toEqual({ status: "bought" });
    expect(mock.callsTo("POST", "/api/lists/l1/items/reorder")).toHaveLength(0);
  });

  it("toggles BOUGHT → TO_BUY when a bought row is tapped (T27 DoD, both directions)", async () => {
    useAuthStore.setState({ accessToken: "t", user: { id: "u1", email: "a@b.co", role: "user" } });
    const mock = createApiFetchMock();
    mock.on("POST", "/api/items/i3/move", () => json(200, { ...BOUGHT[0]!, status: "TO_BUY" }));
    mock.stub();
    renderContainer();

    fireEvent.click(screen.getByRole("button", { name: "Move Butter back to to buy" }));

    await waitFor(() => expect(mock.callsTo("POST", "/api/items/i3/move")).toHaveLength(1));
    expect(mock.callsTo("POST", "/api/items/i3/move")[0]?.body).toEqual({ status: "to_buy" });
  });

  it("toggles from the keyboard (Enter on the focused row body)", async () => {
    useAuthStore.setState({ accessToken: "t", user: { id: "u1", email: "a@b.co", role: "user" } });
    const mock = createApiFetchMock();
    mock.on("POST", "/api/items/i1/move", () => json(200, { ...TO_BUY[0]!, status: "BOUGHT" }));
    mock.stub();
    const user = userEvent.setup();
    renderContainer();

    rowBody("i1").focus();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(mock.callsTo("POST", "/api/items/i1/move")).toHaveLength(1));
  });

  it("does not toggle when the drag handle is tapped (handle is drag-only)", async () => {
    useAuthStore.setState({ accessToken: "t", user: { id: "u1", email: "a@b.co", role: "user" } });
    const mock = createApiFetchMock();
    mock.stub();
    renderContainer();

    // jsdom cannot drive real dnd-kit drags (no layout — T16 finding); the
    // closest pin is that the handle itself never toggles: drags start (and
    // post-drag clicks land) at the handle/section level, never on the row body.
    fireEvent.click(screen.getByTestId("handle-i1"));

    expect(mock.callsTo("POST", "/api/items/i1/move")).toHaveLength(0);
  });

  it("navigates to the details page on a 500 ms long-press of the row body (DoD) without toggling", async () => {
    useAuthStore.setState({ accessToken: "t", user: { id: "u1", email: "a@b.co", role: "user" } });
    const mock = createApiFetchMock();
    mock.stub();
    renderContainer();
    vi.useFakeTimers({ shouldAdvanceTime: true });

    fireEvent.pointerDown(rowBody("i1"), {
      pointerType: "touch",
      clientX: 10,
      clientY: 10,
    });
    await vi.advanceTimersByTimeAsync(500);

    expect(await screen.findByText("details-page")).toBeInTheDocument();
    expect(mock.callsTo("POST", "/api/items/i1/move")).toHaveLength(0);
  });

  it("does not open details when the touch moves (scroll protection)", async () => {
    useAuthStore.setState({ accessToken: "t", user: { id: "u1", email: "a@b.co", role: "user" } });
    const mock = createApiFetchMock();
    mock.stub();
    renderContainer();
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const body = rowBody("i1");
    fireEvent.pointerDown(body, { pointerType: "touch", clientX: 10, clientY: 10 });
    fireEvent.pointerMove(body, { pointerType: "touch", clientX: 40, clientY: 50 });
    await vi.advanceTimersByTime(600);

    expect(screen.queryByText("details-page")).not.toBeInTheDocument();
    expect(mock.callsTo("POST", "/api/items/i1/move")).toHaveLength(0);
  });

  it("does not toggle when the press turned into a scroll (move > 10 px, then a late click)", async () => {
    useAuthStore.setState({ accessToken: "t", user: { id: "u1", email: "a@b.co", role: "user" } });
    const mock = createApiFetchMock();
    mock.stub();
    renderContainer();

    // A scroll gesture: some browsers still emit a trailing click after the
    // pointerup — the row must suppress it (gesture disambiguation, T27 DoD).
    const body = rowBody("i1");
    fireEvent.pointerDown(body, { pointerType: "touch", clientX: 10, clientY: 10 });
    fireEvent.pointerMove(body, { pointerType: "touch", clientX: 10, clientY: 60 });
    fireEvent.pointerUp(body, { pointerType: "touch", clientX: 10, clientY: 60 });
    fireEvent.click(body);

    expect(mock.callsTo("POST", "/api/items/i1/move")).toHaveLength(0);
    expect(screen.queryByText("details-page")).not.toBeInTheDocument();
  });

  it("opens details on right-click (desktop) without toggling", async () => {
    useAuthStore.setState({ accessToken: "t", user: { id: "u1", email: "a@b.co", role: "user" } });
    const mock = createApiFetchMock();
    mock.stub();
    renderContainer();

    fireEvent.contextMenu(rowBody("i1"));

    expect(await screen.findByText("details-page")).toBeInTheDocument();
    expect(mock.callsTo("POST", "/api/items/i1/move")).toHaveLength(0);
  });
});

describe("ItemRow bought styling (docs/TASKS.md → T36)", () => {
  afterEach(() => {
    useAuthStore.setState({ accessToken: null, user: null });
    vi.unstubAllGlobals();
  });

  it("fades a BOUGHT row: strikethrough muted title, muted qty/badge, desaturated bar, dimmed row", () => {
    useAuthStore.setState({ accessToken: "t", user: { id: "u1", email: "a@b.co", role: "user" } });
    createApiFetchMock().stub();
    const boughtWithQty: Item = { ...BOUGHT[0]!, qtyText: "500g" };
    renderContainer(TO_BUY, [boughtWithQty]);

    const title = screen.getByText("Butter");
    expect(title).toHaveClass("line-through", "text-gray-400");
    expect(title).not.toHaveClass("text-gray-900");
    expect(screen.getByText("500g")).toHaveClass("text-gray-400");
    expect(screen.getByLabelText("Butter: 3 days in list")).toHaveClass("text-gray-400");
    const row = screen.getByTestId("item-row-i3");
    expect(row.querySelector("span[aria-hidden='true']")).toHaveClass("grayscale", "opacity-50");
    expect(row).toHaveStyle({ opacity: "0.7" });
  });

  it("keeps a TO_BUY row in the normal style (no strikethrough, full color, full opacity)", () => {
    useAuthStore.setState({ accessToken: "t", user: { id: "u1", email: "a@b.co", role: "user" } });
    createApiFetchMock().stub();
    renderContainer();

    const title = screen.getByText("Milk");
    expect(title).toHaveClass("text-gray-900");
    expect(title).not.toHaveClass("line-through");
    expect(screen.getByText("2x")).toHaveClass("text-gray-500");
    const row = screen.getByTestId("item-row-i1");
    expect(row.querySelector("span[aria-hidden='true']")).not.toHaveClass("grayscale");
    expect(row).not.toHaveStyle({ opacity: "0.7" });
  });

  it("applies the bought style immediately on tap via the optimistic update, and restores it on un-buy (DoD)", async () => {
    useAuthStore.setState({ accessToken: "t", user: { id: "u1", email: "a@b.co", role: "user" } });

    // Deferred move POSTs: the response is held back so assertions can prove
    // the style flipped from the optimistic cache write alone.
    let serverItems: { items: Item[] } = { items: [...TO_BUY, ...BOUGHT] };
    const moveBodies: unknown[] = [];
    const resolvers: Array<(response: Response) => void> = [];
    let getCalls = 0;
    const fakeResponse = (status: number, body?: unknown): Response =>
      ({
        ok: status >= 200 && status < 300,
        status,
        statusText: "OK",
        headers: new Headers(),
        json: async () => body,
      }) as Response;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = new URL(String(input), "http://localhost");
        const method = (init?.method ?? "GET").toUpperCase();
        if (method === "GET" && url.pathname === "/api/lists/l1/items") {
          getCalls += 1;
          return fakeResponse(200, serverItems);
        }
        if (method === "POST" && url.pathname === "/api/items/i1/move") {
          moveBodies.push(JSON.parse(String(init?.body)));
          return new Promise((resolve) => resolvers.push(resolve));
        }
        throw new Error(`Unexpected request: ${method} ${url.pathname}`);
      }),
    );

    // Same wiring as lists-page: items from the ["items", listId] cache.
    function MoveHarness() {
      const items = useItems("l1");
      const all = items.data?.items ?? [];
      return (
        <ItemSectionsContainer
          listId="l1"
          toBuy={all.filter((entry) => entry.status === "TO_BUY")}
          bought={all.filter((entry) => entry.status === "BOUGHT")}
        />
      );
    }
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route path="/" element={<MoveHarness />} />
            <Route path="/items/:itemId" element={<p>details-page</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByTestId("item-row-i1");

    // Buy: the row fades immediately, while the move POST is still pending.
    fireEvent.click(rowBody("i1"));
    await waitFor(() => expect(screen.getByText("Milk")).toHaveClass("line-through"));
    expect(rowBody("i1")).toHaveAttribute("aria-label", "Move Milk back to to buy");
    expect(moveBodies[0]).toEqual({ status: "bought" });
    expect(resolvers).toHaveLength(1);

    // The server confirms; the refetched cache keeps the faded look.
    serverItems = {
      items: [TO_BUY[1]!, { ...TO_BUY[0]!, status: "BOUGHT" }, BOUGHT[0]!],
    };
    resolvers[0]!(fakeResponse(200, { ...TO_BUY[0]!, status: "BOUGHT" }));
    await waitFor(() => expect(getCalls).toBe(2));
    expect(screen.getByText("Milk")).toHaveClass("line-through");

    // Un-buy: the normal look returns immediately (optimistic), then persists.
    fireEvent.click(rowBody("i1"));
    await waitFor(() => expect(screen.getByText("Milk")).not.toHaveClass("line-through"));
    expect(screen.getByText("Milk")).toHaveClass("text-gray-900");
    expect(moveBodies[1]).toEqual({ status: "to_buy" });
    serverItems = { items: [...TO_BUY, ...BOUGHT] };
    resolvers[1]!(fakeResponse(200, TO_BUY[0]!));
    await waitFor(() => expect(getCalls).toBe(3));
    expect(screen.getByText("Milk")).toHaveClass("text-gray-900");
    expect(screen.getByText("Milk")).not.toHaveClass("line-through");
  });
});

/** The row body: the tappable/long-pressable surface (a <button> since T27). */
function rowBody(id: string): HTMLElement {
  return screen.getByTestId(`row-body-${id}`);
}
