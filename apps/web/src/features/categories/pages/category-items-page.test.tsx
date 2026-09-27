import type { Item } from "@grocery/shared";
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { createApiFetchMock, json } from "../../../test/mock-api";
import "../../../test/setup";
import { CategoryItemsPage } from "./category-items-page";

const ADDED_AT = "2026-09-24T08:00:00.000Z";
const CATEGORY = { id: "c1", title: "Dairy", color: "#3B82F6" };

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

function renderPage(initialState?: { listId?: string }): void {
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
    mock.stub();
    const user = userEvent.setup();

    renderPage({ listId: "l1" });

    await user.click(await screen.findByRole("button", { name: "Open details for Milk" }));

    expect(await screen.findByText("details-page")).toBeInTheDocument();
  });

  it("shows an empty state for a category without items", async () => {
    const mock = createApiFetchMock();
    mock.on("GET", "/api/categories/c1/items", () => json(200, { items: [] }));
    mock.stub();

    renderPage({ listId: "l1" });

    expect(await screen.findByText("No items in this category yet.")).toBeInTheDocument();
  });

  it("shows an error state when loading the items fails", async () => {
    const mock = createApiFetchMock();
    mock.on("GET", "/api/categories/c1/items", () =>
      json(500, { error: { code: "INTERNAL_ERROR", message: "boom" } }),
    );
    mock.stub();

    renderPage({ listId: "l1" });

    expect(
      await screen.findByText("Could not load the items of this category."),
    ).toBeInTheDocument();
  });

  it("derives the header from the items when deep-linked without the list context", async () => {
    const mock = createApiFetchMock();
    mock.on("GET", "/api/categories/c1/items", () => json(200, { items: ITEMS }));
    mock.stub();

    renderPage();

    expect(await screen.findByRole("heading", { name: "Dairy" })).toBeInTheDocument();
    expect(mock.callsTo("GET", "/api/lists/l1/categories")).toHaveLength(0);
  });
});
