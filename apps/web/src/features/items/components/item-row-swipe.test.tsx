// @vitest-environment jsdom
import type { Item } from "@grocery/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { useAuthStore } from "../../../stores/auth-store";
import { createApiFetchMock, json } from "../../../test/mock-api";
import "../../../test/setup";
import { ItemSectionsContainer } from "./item-sections-container";

const CATEGORY = { id: "c1", title: "Other", color: "#6B7280" } as const;
const ADDED_AT = "2026-09-24T08:00:00.000Z";

function item(id: string, title: string): Item {
  return {
    id,
    title,
    qtyText: null,
    status: "TO_BUY",
    sortOrder: 0,
    addedAt: ADDED_AT,
    daysInList: 3,
    category: CATEGORY,
    imageFilename: null,
    currentPrice: null,
  };
}

function renderContainer(listId = "l1") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route
            path="/"
            element={
              <ItemSectionsContainer listId={listId} toBuy={[item("i1", "Milk")]} bought={[]} />
            }
          />
          <Route path="/lists/:listId/items/:itemId" element={<DetailsProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function DetailsProbe() {
  const { listId = "", itemId = "" } = useParams<{ listId: string; itemId: string }>();
  return <p data-testid="details-page">{`/lists/${listId}/items/${itemId}`}</p>;
}

function dispatchPointer(
  target: HTMLElement,
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  init: { pointerType?: string; clientX?: number; clientY?: number } = {},
) {
  // jsdom's fireEvent.pointer* drops clientX/clientY/pointerType — dispatch a
  // real Event with the gesture properties assigned so the row's pointer
  // handlers see the same values as a browser.
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    pointerType: init.pointerType ?? "touch",
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
  });
  target.dispatchEvent(event);
}

function rowBody(): HTMLElement {
  return screen.getByTestId("row-body-i1");
}

function swipeLeft() {
  const body = rowBody();
  dispatchPointer(body, "pointerdown", { pointerType: "touch", clientX: 100, clientY: 100 });
  dispatchPointer(body, "pointermove", { pointerType: "touch", clientX: 40, clientY: 102 });
  dispatchPointer(body, "pointerup", { pointerType: "touch", clientX: 40, clientY: 102 });
}

function swipeRight() {
  const body = rowBody();
  dispatchPointer(body, "pointerdown", { pointerType: "touch", clientX: 100, clientY: 100 });
  dispatchPointer(body, "pointermove", { pointerType: "touch", clientX: 170, clientY: 102 });
  dispatchPointer(body, "pointerup", { pointerType: "touch", clientX: 170, clientY: 102 });
}

describe("ItemRow swipe-to-action (T76)", () => {
  afterEach(() => {
    useAuthStore.setState({ accessToken: null, user: null });
  });

  it("left-swipe reveals Edit which opens details (touch only)", async () => {
    useAuthStore.setState({ accessToken: "t", user: { id: "u1", email: "a@b.co", role: "user" } });
    const mock = createApiFetchMock();
    mock.stub();
    renderContainer();

    expect(screen.queryByTestId("edit-i1")).not.toBeInTheDocument();
    swipeLeft();

    const edit = await screen.findByTestId("edit-i1");
    expect(edit).toHaveAttribute("aria-label", "Edit Milk");
    expect(edit.className).toMatch(/min-h-11/);
    expect(mock.callsTo("POST", "/api/items/i1/move")).toHaveLength(0);

    fireEvent.click(edit);
    expect(await screen.findByTestId("details-page")).toHaveTextContent("/lists/l1/items/i1");
  });

  it("right-swipe reveals Delete: arm then confirm issues DELETE", async () => {
    useAuthStore.setState({ accessToken: "t", user: { id: "u1", email: "a@b.co", role: "user" } });
    const mock = createApiFetchMock();
    mock.on("DELETE", "/api/items/i1", () => json(204));
    mock.stub();
    renderContainer();

    swipeRight();

    const arm = await screen.findByTestId("delete-i1");
    expect(arm).toHaveAttribute("aria-label", "Delete Milk");
    expect(arm.className).toMatch(/min-h-11/);

    fireEvent.click(arm);
    const confirm = await screen.findByTestId("confirm-delete-i1");
    expect(confirm).toHaveAttribute("aria-label", "Confirm delete Milk");
    expect(mock.callsTo("DELETE", "/api/items/i1")).toHaveLength(0);

    fireEvent.click(confirm);
    await waitFor(() => expect(mock.callsTo("DELETE", "/api/items/i1")).toHaveLength(1));
  });

  it("vertical scroll never reveals actions", () => {
    useAuthStore.setState({ accessToken: "t", user: { id: "u1", email: "a@b.co", role: "user" } });
    createApiFetchMock().stub();
    renderContainer();

    const body = rowBody();
    dispatchPointer(body, "pointerdown", { pointerType: "touch", clientX: 100, clientY: 100 });
    dispatchPointer(body, "pointermove", { pointerType: "touch", clientX: 105, clientY: 180 });
    dispatchPointer(body, "pointerup", { pointerType: "touch", clientX: 105, clientY: 180 });

    expect(screen.queryByTestId("edit-i1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("delete-i1")).not.toBeInTheDocument();
  });

  it("tap after a swipe never toggles (dismisses the reveal instead)", async () => {
    useAuthStore.setState({ accessToken: "t", user: { id: "u1", email: "a@b.co", role: "user" } });
    const mock = createApiFetchMock();
    mock.on("POST", "/api/items/i1/move", () => json(200, { ...item("i1", "Milk") }));
    mock.stub();
    renderContainer();

    swipeLeft();
    expect(await screen.findByTestId("edit-i1")).toBeInTheDocument();

    // Trailing tap: the earlier swipe moved > 10 px, plus the row is revealed —
    // the click must dismiss, never move/toggle.
    fireEvent.click(rowBody());
    expect(mock.callsTo("POST", "/api/items/i1/move")).toHaveLength(0);
    expect(screen.queryByTestId("edit-i1")).not.toBeInTheDocument();
  });

  it("mouse drag never reveals; right-click still opens details", async () => {
    useAuthStore.setState({ accessToken: "t", user: { id: "u1", email: "a@b.co", role: "user" } });
    const mock = createApiFetchMock();
    mock.stub();
    renderContainer();

    const body = rowBody();
    dispatchPointer(body, "pointerdown", { pointerType: "mouse", clientX: 100, clientY: 100 });
    dispatchPointer(body, "pointermove", { pointerType: "mouse", clientX: 20, clientY: 100 });
    dispatchPointer(body, "pointerup", { pointerType: "mouse", clientX: 20, clientY: 100 });

    expect(screen.queryByTestId("edit-i1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("delete-i1")).not.toBeInTheDocument();

    fireEvent.contextMenu(body);
    expect(await screen.findByTestId("details-page")).toHaveTextContent("/lists/l1/items/i1");
  });

  it("VIEWER delete degrades via the 403 path (banner, no navigation)", async () => {
    useAuthStore.setState({ accessToken: "t", user: { id: "u1", email: "a@b.co", role: "user" } });
    const mock = createApiFetchMock();
    mock.on("DELETE", "/api/items/i1", () =>
      json(403, { error: { code: "FORBIDDEN", message: "forbidden" } }),
    );
    mock.stub();
    renderContainer();

    swipeRight();
    fireEvent.click(await screen.findByTestId("delete-i1"));
    fireEvent.click(await screen.findByTestId("confirm-delete-i1"));

    await waitFor(() => expect(mock.callsTo("DELETE", "/api/items/i1")).toHaveLength(1));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You don't have permission to delete items in this list.",
    );
    expect(screen.queryByTestId("details-page")).not.toBeInTheDocument();
    // The row stays (optimistic removal rolled back via the existing error path).
    expect(screen.getByTestId("item-row-i1")).toBeInTheDocument();
  });
});
