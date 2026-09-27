import type { Item, ListSummary } from "@grocery/shared";
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { App } from "../../../app";
import { type MockResponseSpec, createApiFetchMock, json } from "../../../test/mock-api";
import "../../../test/setup";
import { CategoriesPage } from "./categories-page";

const USER = { id: "u1", email: "alex@example.com", role: "admin" } as const;
const LISTS: ListSummary[] = [
  { id: "l1", title: "Weekly", role: "OWNER", itemCounts: { toBuy: 2, bought: 0 } },
];

const ADDED_AT = "2026-09-24T08:00:00.000Z";

function renderPage(role?: string): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={[{ pathname: "/lists/l1/categories", state: role ? { role } : undefined }]}
      >
        <Routes>
          <Route path="/lists/:listId/categories" element={<CategoriesPage />} />
          <Route path="/categories/:categoryId" element={<p>category-items-page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

interface MockWorld {
  lists: ListSummary[];
  categories: { id: string; title: string; color: string; sortOrder: number; itemCount: number }[];
  items: Item[];
}

function initialWorld(): MockWorld {
  return {
    lists: LISTS,
    categories: [
      { id: "c1", title: "Other", color: "#6B7280", sortOrder: 0, itemCount: 2 },
      { id: "c2", title: "Dairy", color: "#3B82F6", sortOrder: 1, itemCount: 0 },
    ],
    items: [
      {
        id: "i1",
        title: "Milk",
        qtyText: "2x",
        status: "TO_BUY",
        sortOrder: 0,
        addedAt: ADDED_AT,
        daysInList: 3,
        category: { id: "c1", title: "Other", color: "#6B7280" },
        imageFilename: null,
        currentPrice: null,
      },
      {
        id: "i2",
        title: "Bread",
        qtyText: null,
        status: "TO_BUY",
        sortOrder: 1,
        addedAt: ADDED_AT,
        daysInList: 3,
        category: { id: "c1", title: "Other", color: "#6B7280" },
        imageFilename: null,
        currentPrice: null,
      },
    ],
  };
}

/** Stubs the endpoints of the categories page against a mutable world. */
function stubWorld(mock: ReturnType<typeof createApiFetchMock>, world: MockWorld): void {
  mock.on("POST", "/api/auth/refresh", () => json(200, { accessToken: "token-1", user: USER }));
  mock.on("GET", "/api/lists", () => json(200, world.lists));
  mock.on("GET", "/api/lists/l1/categories", () => json(200, world.categories));
  // Items embed the category — always rebuilt from the current world state.
  mock.on("GET", "/api/lists/l1/items", () =>
    json(200, {
      items: world.items.map((item) => ({
        ...item,
        category: {
          ...world.categories.find((category) => category.id === item.category.id),
        },
      })),
    }),
  );
  mock.on("PATCH", "/api/categories/c1", ({ body }): MockResponseSpec => {
    const patch = body as { title?: string; color?: string };
    world.categories = world.categories.map((category) =>
      category.id === "c1" ? { ...category, ...patch } : category,
    );
    return json(200, world.categories[0]);
  });
  mock.on("DELETE", "/api/categories/c2", (): MockResponseSpec => {
    world.categories = world.categories.filter((category) => category.id !== "c2");
    return json(204);
  });
}

describe("CategoriesPage (docs/TASKS.md → T19)", () => {
  it("renders categories with swatch, title, and item counts (OWNER sees Edit/Delete)", async () => {
    const mock = createApiFetchMock();
    const world = initialWorld();
    stubWorld(mock, world);
    mock.stub();

    renderPage("OWNER");

    expect(await screen.findByRole("heading", { name: "Categories" })).toBeInTheDocument();
    expect(await screen.findByTestId("category-row-c1")).toBeInTheDocument();
    expect(screen.getByTestId("category-row-c2")).toBeInTheDocument();
    expect(screen.getByText("Dairy")).toBeInTheDocument();
    expect(screen.getByText("2 items")).toBeInTheDocument();
    expect(screen.getByText("0 items")).toBeInTheDocument();
    expect(screen.getByTestId("category-swatch-c1")).toHaveStyle({ backgroundColor: "#6B7280" });
    expect(screen.getByTestId("category-swatch-c2")).toHaveStyle({ backgroundColor: "#3B82F6" });
    expect(screen.getByRole("button", { name: "Edit Other" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Other" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Dairy" })).toBeInTheDocument();
  });

  it("is read-only for a VIEWER (no Edit/Delete)", async () => {
    const mock = createApiFetchMock();
    stubWorld(mock, initialWorld());
    mock.stub();

    renderPage("VIEWER");

    expect(await screen.findByTestId("category-row-c1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Other" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Other" })).not.toBeInTheDocument();
  });

  it("edits title and color (EDITOR+): PATCH body, optimistic row update, editor closes", async () => {
    const mock = createApiFetchMock();
    const world = initialWorld();
    stubWorld(mock, world);
    mock.stub();
    const user = userEvent.setup();

    renderPage("EDITOR");

    expect(screen.queryByRole("button", { name: "Delete Other" })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Edit Other" }));
    expect(await screen.findByRole("form", { name: "Edit Other" })).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Groceries misc");
    // <input type="color"> normalizes its value to lowercase.
    fireEvent.change(screen.getByLabelText("Color"), { target: { value: "#ff0000" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mock.callsTo("PATCH", "/api/categories/c1")).toHaveLength(1));
    expect(mock.callsTo("PATCH", "/api/categories/c1")[0]?.body).toEqual({
      title: "Groceries misc",
      color: "#ff0000",
    });
    // Optimistic: the row reflects the new values before the response settles.
    expect(screen.getByTestId("category-swatch-c1")).toHaveStyle({ backgroundColor: "#ff0000" });
    expect(screen.getByText("Groceries misc")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole("form", { name: "Edit Other" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Edit Groceries misc" })).toBeInTheDocument();
  });

  it("blocks an empty title client-side without calling the API", async () => {
    const mock = createApiFetchMock();
    stubWorld(mock, initialWorld());
    mock.stub();
    const user = userEvent.setup();

    renderPage("EDITOR");

    await user.click(await screen.findByRole("button", { name: "Edit Other" }));
    await user.clear(await screen.findByLabelText("Title"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(mock.callsTo("PATCH", "/api/categories/c1")).toHaveLength(0);
  });

  it("offers the filtered item view for every category", async () => {
    const mock = createApiFetchMock();
    const world = initialWorld();
    stubWorld(mock, world);
    mock.on("GET", "/api/categories/c1/items", () => json(200, { items: world.items }));
    mock.stub();
    const user = userEvent.setup();

    renderPage("OWNER");

    await user.click(await screen.findByRole("button", { name: "View items in Other" }));

    expect(await screen.findByText("category-items-page")).toBeInTheDocument();
  });

  it("deletes an empty category after confirmation; delete is disabled while items are assigned", async () => {
    const mock = createApiFetchMock();
    const world = initialWorld();
    stubWorld(mock, world);
    mock.stub();
    const user = userEvent.setup();

    renderPage("OWNER");

    const blocked = await screen.findByRole("button", { name: "Delete Other" });
    expect(blocked).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Delete Dairy" }));
    await user.click(await screen.findByRole("button", { name: "Confirm delete Dairy" }));

    expect(mock.callsTo("DELETE", "/api/categories/c2")).toHaveLength(1);
    await waitFor(() => expect(screen.queryByTestId("category-row-c2")).not.toBeInTheDocument());
    expect(screen.getByTestId("category-row-c1")).toBeInTheDocument();
  });

  it("shows an error and keeps the row when the delete fails (409)", async () => {
    const mock = createApiFetchMock();
    const world = initialWorld();
    stubWorld(mock, world);
    mock.on("DELETE", "/api/categories/c2", () =>
      json(409, { error: { code: "CONFLICT", message: "Category still has items" } }),
    );
    mock.stub();
    const user = userEvent.setup();

    renderPage("OWNER");

    await user.click(await screen.findByRole("button", { name: "Delete Dairy" }));
    await user.click(await screen.findByRole("button", { name: "Confirm delete Dairy" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("category-row-c2")).toBeInTheDocument());
  });

  it("shows an error state when loading categories fails", async () => {
    const mock = createApiFetchMock();
    mock.on("POST", "/api/auth/refresh", () => json(200, { accessToken: "token-1", user: USER }));
    mock.on("GET", "/api/lists", () => json(200, LISTS));
    mock.on("GET", "/api/lists/l1/categories", () =>
      json(500, { error: { code: "INTERNAL_ERROR", message: "boom" } }),
    );
    mock.stub();

    renderPage("OWNER");

    expect(await screen.findByText("Could not load the categories.")).toBeInTheDocument();
  });
});

describe("T19 Definition of Done: color change reflects instantly in main screen color bars", () => {
  it("re-colors the main screen's item rows immediately after saving (no refetch needed)", async () => {
    const mock = createApiFetchMock();
    const world = initialWorld();
    stubWorld(mock, world);
    mock.stub();
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/"]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const row = await screen.findByTestId("item-row-i1");
    expect(row.querySelector("span[aria-hidden='true']")).toHaveStyle({
      backgroundColor: "#6B7280",
    });

    await user.click(screen.getByRole("button", { name: "Categories" }));
    await user.click(await screen.findByRole("button", { name: "Edit Other" }));
    fireEvent.change(await screen.findByLabelText("Color"), { target: { value: "#ff0000" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mock.callsTo("PATCH", "/api/categories/c1")).toHaveLength(1));
    // The main screen's items cache is re-colored optimistically (see the
    // deferred-response hook test for the strictly-before-the-response proof);
    // navigating back must show the new color on the item rows right away.
    const itemsCache = queryClient.getQueryData<{ items: Item[] }>(["items", "l1"]);
    expect(itemsCache?.items.map((item) => item.category.color)).toEqual(["#ff0000", "#ff0000"]);

    await user.click(screen.getByRole("button", { name: "Back to the list" }));
    const refreshedRow = await screen.findByTestId("item-row-i1");
    expect(refreshedRow.querySelector("span[aria-hidden='true']")).toHaveStyle({
      backgroundColor: "#ff0000",
    });
  });
});
