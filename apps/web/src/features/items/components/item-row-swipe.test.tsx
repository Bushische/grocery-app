// @vitest-environment jsdom
import type { Item } from "@grocery/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { useAuthStore } from "../../../stores/auth-store";
import { createApiFetchMock, json } from "../../../test/mock-api";
import "../../../test/setup";
import { ItemSectionsContainer } from "./item-sections-container";

const CATEGORY = { id: "c1", title: "Other", color: "#6B7280" } as const;
const CATEGORIES = [
  { id: "c1", title: "Other", color: "#6B7280", sortOrder: 0, itemCount: 1 },
  { id: "c2", title: "Dairy", color: "#3B82F6", sortOrder: 1, itemCount: 0 },
];
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

// Reveal-only swipes (jsdom width falls back to 360 px: reveal ≥ 40,
// commit ≥ 240). Realistic deltas, not full-width drags.
function swipeLeftReveal() {
  const body = rowBody();
  dispatchPointer(body, "pointerdown", { pointerType: "touch", clientX: 200, clientY: 100 });
  dispatchPointer(body, "pointermove", { pointerType: "touch", clientX: 40, clientY: 102 });
  dispatchPointer(body, "pointerup", { pointerType: "touch", clientX: 40, clientY: 102 });
}

function swipeLeftFar() {
  return swipeLeftFarDown().then(() => {
    dispatchPointer(rowBody(), "pointerup", { pointerType: "touch", clientX: 20, clientY: 102 });
  });
}

async function swipeLeftFarDown() {
  const body = rowBody();
  dispatchPointer(body, "pointerdown", { pointerType: "touch", clientX: 300, clientY: 100 });
  dispatchPointer(body, "pointermove", { pointerType: "touch", clientX: 20, clientY: 102 });
  // Flush: the release handler reads post-render state, like the separate
  // browser task between a real move and pointerup.
  await screen.findByTestId("edit-i1");
}

function swipeRightReveal() {
  const body = rowBody();
  dispatchPointer(body, "pointerdown", { pointerType: "touch", clientX: 100, clientY: 100 });
  dispatchPointer(body, "pointermove", { pointerType: "touch", clientX: 260, clientY: 102 });
  dispatchPointer(body, "pointerup", { pointerType: "touch", clientX: 260, clientY: 102 });
}

function swipeRightFar() {
  return swipeRightFarDown().then(() => {
    dispatchPointer(rowBody(), "pointerup", { pointerType: "touch", clientX: 360, clientY: 102 });
  });
}

async function swipeRightFarDown() {
  const body = rowBody();
  dispatchPointer(body, "pointerdown", { pointerType: "touch", clientX: 100, clientY: 100 });
  dispatchPointer(body, "pointermove", { pointerType: "touch", clientX: 360, clientY: 102 });
  // Flush: the release handler reads post-render state, like the separate
  // browser task between a real move and pointerup.
  await screen.findByTestId("delete-i1");
}

function mockCategories(mock: ReturnType<typeof createApiFetchMock>) {
  mock.on("GET", "/api/lists/l1/categories", () => json(200, CATEGORIES));
}

describe("ItemRow swipe-to-action (T76, reworked T84)", () => {
  afterEach(() => {
    useAuthStore.setState({ accessToken: null, user: null });
  });

  it("row body is touch-pan-y so Android delivers horizontal moves", () => {
    useAuthStore.setState({ accessToken: "t", user: { id: "u1", email: "a@b.co", role: "user" } });
    createApiFetchMock().stub();
    renderContainer();

    expect(rowBody().className).toMatch(/touch-pan-y/);
  });

  it("left-swipe reveals Edit; tapping it opens the edit sheet, not details", async () => {
    useAuthStore.setState({ accessToken: "t", user: { id: "u1", email: "a@b.co", role: "user" } });
    const mock = createApiFetchMock();
    mockCategories(mock);
    mock.stub();
    renderContainer();

    expect(screen.queryByTestId("edit-i1")).not.toBeInTheDocument();
    swipeLeftReveal();

    const edit = await screen.findByTestId("edit-i1");
    expect(edit).toHaveAttribute("aria-label", "Edit Milk");
    expect(edit.className).toMatch(/min-h-11/);
    expect(mock.callsTo("POST", "/api/items/i1/move")).toHaveLength(0);

    fireEvent.click(edit);
    expect(await screen.findByTestId("edit-sheet-i1")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveDisplayValue("Milk");
    expect(screen.queryByTestId("details-page")).not.toBeInTheDocument();
  });

  it("far-left release opens the edit sheet directly", async () => {
    useAuthStore.setState({ accessToken: "t", user: { id: "u1", email: "a@b.co", role: "user" } });
    const mock = createApiFetchMock();
    mockCategories(mock);
    mock.stub();
    renderContainer();

    await swipeLeftFar();

    expect(await screen.findByTestId("edit-sheet-i1")).toBeInTheDocument();
  });

  it("edit sheet saves the title (PATCH) and closes", async () => {
    useAuthStore.setState({ accessToken: "t", user: { id: "u1", email: "a@b.co", role: "user" } });
    const mock = createApiFetchMock();
    mockCategories(mock);
    mock.on("PATCH", "/api/items/i1", () => json(200, { ...item("i1", "Oat milk") }));
    mock.stub();
    renderContainer();
    const user = userEvent.setup();

    swipeLeftReveal();
    fireEvent.click(await screen.findByTestId("edit-i1"));
    const title = await screen.findByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Oat milk");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(mock.callsTo("PATCH", "/api/items/i1")).toHaveLength(1));
    await waitFor(() => expect(screen.queryByTestId("edit-sheet-i1")).not.toBeInTheDocument());
  });

  it("right-swipe reveals Delete; tapping it deletes (second gesture confirms)", async () => {
    useAuthStore.setState({ accessToken: "t", user: { id: "u1", email: "a@b.co", role: "user" } });
    const mock = createApiFetchMock();
    mock.on("DELETE", "/api/items/i1", () => json(204));
    mock.stub();
    renderContainer();

    swipeRightReveal();

    const del = await screen.findByTestId("delete-i1");
    expect(del).toHaveAttribute("aria-label", "Delete Milk");
    expect(del.className).toMatch(/min-h-11/);
    expect(mock.callsTo("DELETE", "/api/items/i1")).toHaveLength(0);

    fireEvent.click(del);
    await waitFor(() => expect(mock.callsTo("DELETE", "/api/items/i1")).toHaveLength(1));
  });

  it("far-right release deletes outright (the slide is the confirmation)", async () => {
    useAuthStore.setState({ accessToken: "t", user: { id: "u1", email: "a@b.co", role: "user" } });
    const mock = createApiFetchMock();
    mock.on("DELETE", "/api/items/i1", () => json(204));
    mock.stub();
    renderContainer();

    await swipeRightFar();

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

    swipeLeftReveal();
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

  it("VIEWER delete degrades via the 403 path (banner, row stays)", async () => {
    useAuthStore.setState({ accessToken: "t", user: { id: "u1", email: "a@b.co", role: "user" } });
    const mock = createApiFetchMock();
    mock.on("DELETE", "/api/items/i1", () =>
      json(403, { error: { code: "FORBIDDEN", message: "forbidden" } }),
    );
    mock.stub();
    renderContainer();

    await swipeRightFar();

    await waitFor(() => expect(mock.callsTo("DELETE", "/api/items/i1")).toHaveLength(1));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You don't have permission to delete items in this list.",
    );
    expect(screen.queryByTestId("details-page")).not.toBeInTheDocument();
    // The row stays (optimistic removal rolled back via the existing error path).
    expect(screen.getByTestId("item-row-i1")).toBeInTheDocument();
  });
});
