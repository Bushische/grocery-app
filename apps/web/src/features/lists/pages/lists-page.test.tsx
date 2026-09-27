import type { ListSummary } from "@grocery/shared";
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { type MockResponseSpec, createApiFetchMock, json } from "../../../test/mock-api";
import { ListsPage } from "./lists-page";
import "../../../test/setup";

const USER = { id: "u1", email: "alex@example.com", role: "admin" } as const;
const ADDED_AT = "2026-09-24T08:00:00.000Z";
const CATEGORY = { id: "c1", title: "Other", color: "#6B7280" };

const LISTS: ListSummary[] = [
  { id: "l1", title: "Weekly", role: "OWNER", itemCounts: { toBuy: 2, bought: 1 } },
  { id: "l2", title: "Party", role: "EDITOR", itemCounts: { toBuy: 0, bought: 0 } },
];

const ITEMS_L1 = {
  items: [
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
      title: "Bread",
      qtyText: null,
      status: "BOUGHT",
      sortOrder: 0,
      addedAt: ADDED_AT,
      daysInList: 1,
      category: CATEGORY,
      imageFilename: null,
      currentPrice: null,
    },
  ],
};
const EMPTY_ITEMS = { items: [] };

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ListsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function stubDefaultRoutes(mock: ReturnType<typeof createApiFetchMock>): void {
  mock.on("POST", "/api/auth/refresh", () => json(200, { accessToken: "token-1", user: USER }));
  mock.on("GET", "/api/lists", () => json(200, LISTS));
  mock.on("GET", "/api/lists/l1/items", () => json(200, ITEMS_L1));
  mock.on("GET", "/api/lists/l2/items", () => json(200, EMPTY_ITEMS));
  mock.on("DELETE", "/api/lists/l1", (): MockResponseSpec => json(204));
  mock.on("POST", "/api/lists", ({ body }) =>
    json(201, {
      id: "l3",
      title: (body as { title: string }).title,
      role: "OWNER",
      itemCounts: { toBuy: 0, bought: 0 },
    }),
  );
  mock.on("GET", "/api/lists/l3/items", () => json(200, EMPTY_ITEMS));
}

describe("ListsPage (docs/TASKS.md → T15)", () => {
  it("renders tabs for the user's lists with the selected list's items and counts", async () => {
    const mock = createApiFetchMock();
    stubDefaultRoutes(mock);
    mock.stub();

    renderPage();

    const weeklyTab = await screen.findByRole("tab", { name: "Weekly" });
    expect(weeklyTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Party" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByText("2 to buy · 1 bought")).toBeInTheDocument();
    expect(await screen.findByText("Milk · 2x · 3d")).toBeInTheDocument();
    expect(screen.getByText("Bread")).toBeInTheDocument();
    expect(mock.callsTo("GET", "/api/lists/l1/items")).toHaveLength(1);
    expect(mock.callsTo("GET", "/api/lists/l2/items")).toHaveLength(0);
    expect(screen.getByText("alex@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("switching lists refetches that list's items (DoD)", async () => {
    const mock = createApiFetchMock();
    stubDefaultRoutes(mock);
    mock.stub();
    const user = userEvent.setup();

    renderPage();
    await screen.findByText("Milk · 2x · 3d");
    expect(mock.callsTo("GET", "/api/lists/l1/items")).toHaveLength(1);

    await user.click(screen.getByRole("tab", { name: "Party" }));

    await waitFor(() => expect(mock.callsTo("GET", "/api/lists/l2/items")).toHaveLength(1));
    expect(screen.getByRole("tab", { name: "Party" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Weekly" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByText("0 to buy · 0 bought")).toBeInTheDocument();
    expect(screen.queryByText("Milk · 2x · 3d")).not.toBeInTheDocument();
    expect(screen.getByText("No items to buy.")).toBeInTheDocument();

    // Switching back refetches the first list again (staleTime 0).
    await user.click(screen.getByRole("tab", { name: "Weekly" }));
    await waitFor(() => expect(mock.callsTo("GET", "/api/lists/l1/items")).toHaveLength(2));
    expect(await screen.findByText("Milk · 2x · 3d")).toBeInTheDocument();
  });

  it("shows delete only for lists where the user is OWNER (DoD)", async () => {
    const mock = createApiFetchMock();
    stubDefaultRoutes(mock);
    mock.stub();
    const user = userEvent.setup();

    renderPage();
    expect(await screen.findByRole("button", { name: "Delete list" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Party" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Delete list" })).not.toBeInTheDocument(),
    );

    await user.click(screen.getByRole("tab", { name: "Weekly" }));
    expect(await screen.findByRole("button", { name: "Delete list" })).toBeInTheDocument();
  });

  it("deletes the selected OWNER list and falls back to another list", async () => {
    let currentLists: ListSummary[] = LISTS;
    const mock = createApiFetchMock();
    mock.on("POST", "/api/auth/refresh", () => json(200, { accessToken: "token-1", user: USER }));
    mock.on("GET", "/api/lists", () => json(200, currentLists));
    mock.on("GET", "/api/lists/l1/items", () => json(200, ITEMS_L1));
    mock.on("GET", "/api/lists/l2/items", () => json(200, EMPTY_ITEMS));
    mock.on("DELETE", "/api/lists/l1", () => {
      currentLists = currentLists.filter((list) => list.id !== "l1");
      return json(204);
    });
    mock.stub();
    const user = userEvent.setup();

    renderPage();
    await user.click(await screen.findByRole("button", { name: "Delete list" }));
    await user.click(await screen.findByRole("button", { name: "Confirm delete" }));

    expect(mock.callsTo("DELETE", "/api/lists/l1")).toHaveLength(1);
    await waitFor(() =>
      expect(screen.queryByRole("tab", { name: "Weekly" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("tab", { name: "Party" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(mock.callsTo("GET", "/api/lists/l2/items")).toHaveLength(1));
    expect(screen.queryByRole("button", { name: "Delete list" })).not.toBeInTheDocument();
  });

  it("creates a list, selects it, and refetches its items", async () => {
    let currentLists: ListSummary[] = LISTS;
    const mock = createApiFetchMock();
    mock.on("POST", "/api/auth/refresh", () => json(200, { accessToken: "token-1", user: USER }));
    mock.on("GET", "/api/lists", () => json(200, currentLists));
    mock.on("GET", "/api/lists/l1/items", () => json(200, ITEMS_L1));
    mock.on("GET", "/api/lists/l2/items", () => json(200, EMPTY_ITEMS));
    mock.on("POST", "/api/lists", ({ body }) => {
      const created: ListSummary = {
        id: "l3",
        title: (body as { title: string }).title,
        role: "OWNER",
        itemCounts: { toBuy: 0, bought: 0 },
      };
      currentLists = [...currentLists, created];
      return json(201, created);
    });
    mock.on("GET", "/api/lists/l3/items", () => json(200, EMPTY_ITEMS));
    mock.stub();
    const user = userEvent.setup();

    renderPage();
    await user.click(await screen.findByRole("button", { name: "New list" }));
    await user.type(screen.getByLabelText("List title"), "Party prep");
    await user.click(screen.getByRole("button", { name: "Create" }));

    const createCall = mock.callsTo("POST", "/api/lists")[0];
    expect(createCall?.body).toEqual({ title: "Party prep" });
    const newTab = await screen.findByRole("tab", { name: "Party prep" });
    expect(newTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toBeInTheDocument();
    await waitFor(() => expect(mock.callsTo("GET", "/api/lists/l3/items")).toHaveLength(1));
    expect(screen.queryByLabelText("List title")).not.toBeInTheDocument();
  });

  it("blocks creating a list with an empty title", async () => {
    const mock = createApiFetchMock();
    stubDefaultRoutes(mock);
    mock.stub();
    const user = userEvent.setup();

    renderPage();
    await user.click(await screen.findByRole("button", { name: "New list" }));
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(mock.callsTo("POST", "/api/lists")).toHaveLength(0);
  });

  it("shows an error state when loading lists fails", async () => {
    const mock = createApiFetchMock();
    mock.on("POST", "/api/auth/refresh", () => json(200, { accessToken: "token-1", user: USER }));
    mock.on("GET", "/api/lists", () =>
      json(500, { error: { code: "INTERNAL_ERROR", message: "boom" } }),
    );
    mock.stub();

    renderPage();

    expect(await screen.findByText("Could not load your lists.")).toBeInTheDocument();
  });
});
