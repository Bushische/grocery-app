import type { Item, ListSummary } from "@grocery/shared";
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { createApiFetchMock, json } from "../../../test/mock-api";
import "../../../test/setup";
import { CategoryItemsPage } from "./category-items-page";

const ADDED_AT = "2026-09-24T08:00:00.000Z";
const CATEGORY = { id: "c1", title: "Dairy", color: "#3B82F6" };
const BAKERY = { id: "c2", title: "Bakery", color: "#F59E0B" };

const ITEMS: Item[] = [
  {
    id: "i1",
    title: "Milk",
    qtyText: "2x",
    status: "TO_BUY",
    sortOrder: 0,
    addedAt: ADDED_AT,
    daysInList: 3,
    category: CATEGORY,
    imageFilename: null,
    currentPrice: null,
  },
  {
    id: "i2",
    title: "Butter",
    qtyText: null,
    status: "BOUGHT",
    sortOrder: 0,
    addedAt: ADDED_AT,
    daysInList: 1,
    category: CATEGORY,
    imageFilename: null,
    currentPrice: null,
  },
];

function item(partial: Partial<Item> & Pick<Item, "id" | "title" | "status">): Item {
  return {
    qtyText: null,
    sortOrder: 0,
    addedAt: ADDED_AT,
    daysInList: 0,
    category: CATEGORY,
    imageFilename: null,
    currentPrice: null,
    ...partial,
  };
}

/** A summary row for the role fallback lookup (docs/CONVENTIONS.md → Frontend keys). */
function listsWith(role: "OWNER" | "EDITOR" | "VIEWER"): ListSummary[] {
  return [{ id: "l1", title: "Weekly", role, itemCounts: { toBuy: 1, bought: 1 } }];
}

function renderPage(initialState?: { listId?: string; role?: string }): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={[
          {
            pathname: "/categories/c1",
            state: initialState,
          },
        ]}
      >
        <Routes>
          <Route path="/categories/:categoryId" element={<CategoryItemsPage />} />
          {/* T41: with a list context the details open at the canonical nested URL. */}
          <Route path="/lists/:listId/items/:itemId" element={<p>details-page</p>} />
          <Route path="/items/:itemId" element={<p>details-page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("CategoryItemsPage (docs/TASKS.md → T19 filtered item view)", () => {
  it("renders the category's items with color bars and status badges", async () => {
    const mock = createApiFetchMock();
    mock.on("GET", "/api/categories/c1/items", () => json(200, { items: ITEMS }));
    mock.on("GET", "/api/lists", () => json(200, listsWith("VIEWER")));
    mock.stub();

    renderPage({ listId: "l1" });

    expect(await screen.findByRole("heading", { name: "Dairy" })).toBeInTheDocument();
    expect(screen.getByTestId("category-item-i1")).toBeInTheDocument();
    expect(screen.getByTestId("category-item-i2")).toBeInTheDocument();
    expect(screen.getByText("Milk")).toBeInTheDocument();
    expect(screen.getByText("Butter")).toBeInTheDocument();
    expect(screen.getByText("to buy")).toBeInTheDocument();
    expect(screen.getByText("bought")).toBeInTheDocument();
    expect(
      screen.getByTestId("category-item-i1").querySelector("span[aria-hidden='true']"),
    ).toHaveStyle({ backgroundColor: "#3B82F6" });
  });

  it("opens the item details on tap", async () => {
    const mock = createApiFetchMock();
    mock.on("GET", "/api/categories/c1/items", () => json(200, { items: ITEMS }));
    mock.on("GET", "/api/lists", () => json(200, listsWith("VIEWER")));
    mock.stub();
    const user = userEvent.setup();

    renderPage({ listId: "l1" });

    await user.click(await screen.findByRole("button", { name: "Open details for Milk" }));

    expect(await screen.findByText("details-page")).toBeInTheDocument();
  });

  it("shows an empty state for a category without items", async () => {
    const mock = createApiFetchMock();
    mock.on("GET", "/api/categories/c1/items", () => json(200, { items: [] }));
    mock.on("GET", "/api/lists", () => json(200, listsWith("VIEWER")));
    mock.stub();

    renderPage({ listId: "l1" });

    expect(await screen.findByText("No items in this category yet.")).toBeInTheDocument();
  });

  it("shows an error state when loading the items fails", async () => {
    const mock = createApiFetchMock();
    mock.on("GET", "/api/categories/c1/items", () =>
      json(500, { error: { code: "INTERNAL_ERROR", message: "boom" } }),
    );
    mock.on("GET", "/api/lists", () => json(200, listsWith("VIEWER")));
    mock.stub();

    renderPage({ listId: "l1" });

    expect(
      await screen.findByText("Could not load the items of this category."),
    ).toBeInTheDocument();
  });

  it("derives the header from the items when deep-linked without the list context", async () => {
    const mock = createApiFetchMock();
    mock.on("GET", "/api/categories/c1/items", () => json(200, { items: ITEMS }));
    mock.on("GET", "/api/lists", () => json(200, listsWith("VIEWER")));
    mock.stub();

    renderPage();

    expect(await screen.findByRole("heading", { name: "Dairy" })).toBeInTheDocument();
    expect(mock.callsTo("GET", "/api/lists/l1/categories")).toHaveLength(0);
    // T43: with no list context (and a VIEWER role at best) the page stays read-only.
    expect(screen.queryByTestId("add-item-bar")).not.toBeInTheDocument();
  });
});

describe("CategoryItemsPage add-from-category bar (docs/TASKS.md → T43)", () => {
  /** Suggest returns two groups — only the Dairy one may surface in the popover. */
  const MIXED_SUGGESTIONS = {
    groups: [
      {
        category: CATEGORY,
        items: [
          { id: "i1", title: "Milk", qtyText: "2x", status: "TO_BUY" },
          { id: "i2", title: "Butter", qtyText: null, status: "BOUGHT" },
        ],
      },
      {
        category: BAKERY,
        items: [{ id: "i3", title: "Milk roll", qtyText: null, status: "TO_BUY" }],
      },
    ],
  };

  it("creates an item in this category from the Create row (DoD)", async () => {
    const mock = createApiFetchMock();
    let serverItems = { items: [item({ id: "i1", title: "Milk", status: "TO_BUY" })] };
    const created = item({ id: "i9", title: "Yogurt", status: "TO_BUY" });
    mock.on("GET", "/api/lists", () => json(200, listsWith("EDITOR")));
    mock.on("GET", "/api/categories/c1/items", () => json(200, serverItems));
    mock.on("GET", "/api/items/suggest", () => json(200, MIXED_SUGGESTIONS));
    mock.on("POST", "/api/lists/l1/items", () => {
      serverItems = { items: [...serverItems.items, created] };
      return json(201, created);
    });
    mock.stub();
    const user = userEvent.setup();

    renderPage({ listId: "l1", role: "EDITOR" });
    await screen.findByTestId("category-item-i1");

    await user.type(screen.getByLabelText("Add item"), "Yogurt");
    await user.click(await screen.findByTestId("create-item-row"));

    await waitFor(() => expect(mock.callsTo("POST", "/api/lists/l1/items")).toHaveLength(1));
    expect(mock.callsTo("POST", "/api/lists/l1/items")[0]?.body).toEqual({
      title: "Yogurt",
      categoryId: "c1",
    });
    // The row lands in this category's view (refetch of the category items).
    await waitFor(() => expect(mock.callsTo("GET", "/api/categories/c1/items")).toHaveLength(2));
    expect(await screen.findByText("Yogurt")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Add item")).toHaveValue(""));
    expect(screen.queryByTestId("suggestions-popover")).not.toBeInTheDocument();
  });

  it("re-activates a bought suggestion in place via move (DoD)", async () => {
    const mock = createApiFetchMock();
    let serverItems = { items: [item({ id: "i2", title: "Butter", status: "BOUGHT" })] };
    mock.on("GET", "/api/lists", () => json(200, listsWith("EDITOR")));
    mock.on("GET", "/api/categories/c1/items", () => json(200, serverItems));
    mock.on("GET", "/api/items/suggest", () => json(200, MIXED_SUGGESTIONS));
    mock.on("POST", "/api/items/i2/move", () => {
      serverItems = { items: [item({ id: "i2", title: "Butter", status: "TO_BUY" })] };
      return json(200, serverItems.items[0]);
    });
    mock.stub();
    const user = userEvent.setup();

    renderPage({ listId: "l1", role: "EDITOR" });
    expect(await screen.findByText("bought")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Add item"), "Butter");
    await user.click(await screen.findByTestId("suggestion-i2"));

    await waitFor(() => expect(mock.callsTo("POST", "/api/items/i2/move")).toHaveLength(1));
    expect(mock.callsTo("POST", "/api/items/i2/move")[0]?.body).toEqual({ status: "to_buy" });
    // Plain create / smart-add are never used for a suggestion tap.
    expect(mock.callsTo("POST", "/api/lists/l1/items")).toHaveLength(0);
    expect(mock.callsTo("POST", "/api/lists/l1/items/smart-add")).toHaveLength(0);
    // The item re-activates in place — the refetched view shows "to buy".
    await waitFor(() => expect(mock.callsTo("GET", "/api/categories/c1/items")).toHaveLength(2));
    expect(await screen.findByText("to buy")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Add item")).toHaveValue(""));
    expect(screen.queryByTestId("suggestions-popover")).not.toBeInTheDocument();
  });

  it("suggests only this category's items; a to-buy tap is a no-op that just closes (DoD)", async () => {
    const mock = createApiFetchMock();
    mock.on("GET", "/api/lists", () => json(200, listsWith("EDITOR")));
    mock.on("GET", "/api/categories/c1/items", () => json(200, { items: ITEMS }));
    mock.on("GET", "/api/items/suggest", () => json(200, MIXED_SUGGESTIONS));
    mock.stub();
    const user = userEvent.setup();

    renderPage({ listId: "l1", role: "EDITOR" });
    await screen.findByTestId("category-item-i1");

    await user.type(screen.getByLabelText("Add item"), "mi");
    const popover = await screen.findByTestId("suggestions-popover");
    expect(await screen.findByTestId("suggestion-i1")).toBeInTheDocument();
    // Category scoping: the Bakery group of the same server payload is hidden.
    expect(screen.queryByTestId("suggestion-i3")).not.toBeInTheDocument();
    expect(popover).toContainElement(screen.getByTestId("suggestion-i1"));

    // A TO_BUY suggestion is already listed — tapping it only closes the layer.
    await user.click(screen.getByTestId("suggestion-i1"));
    expect(mock.calls.filter((call) => call.method === "POST")).toHaveLength(0);
    expect(screen.queryByTestId("suggestions-popover")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Add item")).toHaveValue("mi");
  });

  it("keeps the page read-only for a VIEWER: no bar, no suggest calls (DoD)", async () => {
    const mock = createApiFetchMock();
    mock.on("GET", "/api/lists", () => json(200, listsWith("VIEWER")));
    mock.on("GET", "/api/categories/c1/items", () => json(200, { items: ITEMS }));
    mock.stub();

    renderPage({ listId: "l1", role: "VIEWER" });
    await screen.findByTestId("category-item-i1");

    expect(screen.queryByTestId("add-item-bar")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Add item")).not.toBeInTheDocument();
    expect(mock.callsTo("GET", "/api/items/suggest")).toHaveLength(0);
  });

  it("fills the role in from the lists cache on a deep link (EDITOR gets the bar)", async () => {
    const mock = createApiFetchMock();
    mock.on("GET", "/api/lists", () => json(200, listsWith("EDITOR")));
    mock.on("GET", "/api/categories/c1/items", () => json(200, { items: ITEMS }));
    mock.stub();

    renderPage({ listId: "l1" });

    expect(await screen.findByLabelText("Add item")).toBeInTheDocument();
    expect(screen.getByTestId("add-item-bar")).toBeInTheDocument();
  });

  it("creates in this category on form submit (Enter path); smart-add is never used", async () => {
    const mock = createApiFetchMock();
    mock.on("GET", "/api/lists", () => json(200, listsWith("EDITOR")));
    mock.on("GET", "/api/categories/c1/items", () => json(200, { items: ITEMS }));
    mock.on("GET", "/api/items/suggest", () => json(200, { groups: [] }));
    mock.on("POST", "/api/lists/l1/items", () =>
      json(201, item({ id: "i9", title: "Unheard of thing", status: "TO_BUY" })),
    );
    mock.stub();
    const user = userEvent.setup();

    renderPage({ listId: "l1", role: "EDITOR" });
    await screen.findByTestId("category-item-i1");

    await user.type(screen.getByLabelText("Add item"), "Unheard of thing");
    // Submit path of the form (jsdom has no implicit Enter submission).
    fireEvent.submit(screen.getByLabelText("Add item").closest("form") as HTMLFormElement);

    await waitFor(() => expect(mock.callsTo("POST", "/api/lists/l1/items")).toHaveLength(1));
    expect(mock.callsTo("POST", "/api/lists/l1/items")[0]?.body).toEqual({
      title: "Unheard of thing",
      categoryId: "c1",
    });
    expect(mock.callsTo("POST", "/api/lists/l1/items/smart-add")).toHaveLength(0);
    await waitFor(() => expect(screen.getByLabelText("Add item")).toHaveValue(""));
  });

  it("shows an error and keeps the popover open when the create fails", async () => {
    const mock = createApiFetchMock();
    mock.on("GET", "/api/lists", () => json(200, listsWith("EDITOR")));
    mock.on("GET", "/api/categories/c1/items", () => json(200, { items: ITEMS }));
    mock.on("GET", "/api/items/suggest", () => json(200, { groups: [] }));
    mock.on("POST", "/api/lists/l1/items", () =>
      json(403, { error: { code: "FORBIDDEN", message: "denied" } }),
    );
    mock.stub();
    const user = userEvent.setup();

    renderPage({ listId: "l1", role: "EDITOR" });
    await screen.findByTestId("category-item-i1");

    await user.type(screen.getByLabelText("Add item"), "Yogurt");
    await user.click(await screen.findByTestId("create-item-row"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not add the item.");
    expect(screen.getByLabelText("Add item")).toHaveValue("Yogurt");
    expect(screen.getByTestId("suggestions-popover")).toBeInTheDocument();
    expect(screen.getByTestId("create-item-row")).toBeInTheDocument();
  });
});
