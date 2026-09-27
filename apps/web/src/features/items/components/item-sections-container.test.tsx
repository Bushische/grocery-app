import type { Item } from "@grocery/shared";
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "../../../stores/auth-store";
import { createApiFetchMock, json } from "../../../test/mock-api";
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

describe("ItemSectionsContainer (docs/TASKS.md → T16)", () => {
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

  it("calls POST /items/:id/move when the buy toggle is pressed", async () => {
    useAuthStore.setState({ accessToken: "t", user: { id: "u1", email: "a@b.co", role: "user" } });
    const mock = createApiFetchMock();
    mock.on("POST", "/api/items/i1/move", () => json(200, { ...TO_BUY[0]!, status: "BOUGHT" }));
    mock.stub();
    const user = userEvent.setup();
    renderContainer();

    await user.click(screen.getByRole("button", { name: "Mark Milk as bought" }));

    await waitFor(() => expect(mock.callsTo("POST", "/api/items/i1/move")).toHaveLength(1));
    expect(mock.callsTo("POST", "/api/items/i1/move")[0]?.body).toEqual({ status: "bought" });
    expect(mock.callsTo("POST", "/api/lists/l1/items/reorder")).toHaveLength(0);
  });

  it("navigates to the details page on a 500 ms long-press of the row body (DoD)", async () => {
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
  });

  it("opens details on right-click (desktop)", async () => {
    useAuthStore.setState({ accessToken: "t", user: { id: "u1", email: "a@b.co", role: "user" } });
    const mock = createApiFetchMock();
    mock.stub();
    renderContainer();

    fireEvent.contextMenu(rowBody("i1"));

    expect(await screen.findByText("details-page")).toBeInTheDocument();
  });
});

/** The long-press / right-click surface: the row's body div. */
function rowBody(id: string): HTMLElement {
  const body = screen.getByTestId(`item-row-${id}`).querySelector("div");
  if (!body) throw new Error("row body missing");
  return body as HTMLElement;
}
