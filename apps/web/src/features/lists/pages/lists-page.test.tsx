import type { ListSummary } from "@grocery/shared";
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
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

/** Same as renderPage, plus probe routes for the pages the menu navigates to. */
function renderPageWithRoutes() {
  function NavStateProbe({ label }: { label: string }) {
    const location = useLocation();
    return <p>{`${label}:${JSON.stringify(location.state ?? {})}`}</p>;
  }
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<ListsPage />} />
          <Route
            path="/lists/:listId/categories"
            element={<NavStateProbe label="categories-page" />}
          />
          <Route path="/lists/:listId/members" element={<NavStateProbe label="members-page" />} />
          <Route path="/users" element={<NavStateProbe label="users-page" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function stubDefaultRoutes(
  mock: ReturnType<typeof createApiFetchMock>,
  options?: { role?: "admin" | "user" },
): void {
  mock.on("POST", "/api/auth/refresh", () =>
    json(200, { accessToken: "token-1", user: { ...USER, role: options?.role ?? USER.role } }),
  );
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
  mock.on("POST", "/api/auth/logout", (): MockResponseSpec => json(204));
}

async function openMenu(user: UserEvent): Promise<HTMLElement> {
  await user.click(screen.getByRole("button", { name: "Menu" }));
  return screen.findByTestId("menu-panel");
}

describe("ListsPage (docs/TASKS.md → T30 single-line header + overlay menu)", () => {
  it("renders exactly one header line: the list's name plus the menu button (DoD)", async () => {
    const mock = createApiFetchMock();
    stubDefaultRoutes(mock);
    mock.stub();

    renderPage();

    expect(await screen.findByRole("heading", { name: "Weekly" })).toBeInTheDocument();
    const banner = screen.getByRole("banner");
    expect(within(banner).getByRole("heading", { name: "Weekly" })).toBeInTheDocument();
    expect(within(banner).getByRole("button", { name: "Menu" })).toBeInTheDocument();
    // Nothing else is mounted in the header line — no account/sign-out there anymore.
    expect(within(banner).queryAllByRole("button")).toHaveLength(1);
    // The old stacked header and the tabs row are gone from the page.
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.queryByText("alex@example.com")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();

    // The main screen itself is unaffected: counts + items.
    expect(screen.getByText("2 to buy · 1 bought")).toBeInTheDocument();
    expect((await screen.findByTestId("item-row-i1")).textContent).toContain("Milk");
    expect(screen.getByText("Bread")).toBeInTheDocument();
    expect(mock.callsTo("GET", "/api/lists/l1/items")).toHaveLength(1);
  });

  it("opens the overlay menu with the account block; closes on Escape and backdrop tap", async () => {
    const mock = createApiFetchMock();
    stubDefaultRoutes(mock);
    mock.stub();
    const user = userEvent.setup();

    renderPage();
    await screen.findByTestId("item-row-i1");

    await openMenu(user);
    expect(screen.getByTestId("menu-user-email")).toHaveTextContent("alex@example.com");
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("menu-overlay")).not.toBeInTheDocument();

    await openMenu(user);
    await user.click(screen.getByTestId("menu-backdrop"));
    expect(screen.queryByTestId("menu-overlay")).not.toBeInTheDocument();
    // Closing restores focus to the menu trigger.
    expect(screen.getByRole("button", { name: "Menu" })).toHaveFocus();
  });

  it("switches lists from the menu switcher and refetches their items (DoD)", async () => {
    const mock = createApiFetchMock();
    stubDefaultRoutes(mock);
    mock.stub();
    const user = userEvent.setup();

    renderPage();
    await screen.findByTestId("item-row-i1");
    expect(mock.callsTo("GET", "/api/lists/l2/items")).toHaveLength(0);

    await openMenu(user);
    const partyRow = screen.getByRole("button", { name: "Party EDITOR" });
    expect(within(partyRow).getByText("EDITOR")).toBeInTheDocument();
    const weeklyRow = screen.getByRole("button", { name: "Weekly OWNER" });
    expect(weeklyRow).toHaveAttribute("aria-current", "true");
    await user.click(partyRow);

    expect(screen.queryByTestId("menu-overlay")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Party" })).toBeInTheDocument();
    await waitFor(() => expect(mock.callsTo("GET", "/api/lists/l2/items")).toHaveLength(1));
    expect(screen.getByText("0 to buy · 0 bought")).toBeInTheDocument();
    expect(screen.getByText("No items to buy.")).toBeInTheDocument();

    // Switching back refetches the first list again (staleTime 0).
    await openMenu(user);
    await user.click(screen.getByRole("button", { name: "Weekly OWNER" }));
    await waitFor(() => expect(mock.callsTo("GET", "/api/lists/l1/items")).toHaveLength(2));
    expect((await screen.findByTestId("item-row-i1")).textContent).toContain("Milk");
  });

  it("deletes the selected OWNER list from the menu and falls back to another list", async () => {
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
    await screen.findByTestId("item-row-i1");

    await openMenu(user);
    await user.click(screen.getByRole("button", { name: "Delete list" }));
    await user.click(screen.getByRole("button", { name: "Confirm delete" }));

    expect(mock.callsTo("DELETE", "/api/lists/l1")).toHaveLength(1);
    expect(screen.queryByTestId("menu-overlay")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Party" })).toBeInTheDocument());
  });

  it("hides the OWNER-only actions (delete, members) for a non-OWNER selected list", async () => {
    const mock = createApiFetchMock();
    stubDefaultRoutes(mock);
    mock.stub();
    const user = userEvent.setup();

    renderPage();
    await screen.findByTestId("item-row-i1");

    // Switch to the EDITOR list first.
    await openMenu(user);
    await user.click(screen.getByRole("button", { name: "Party EDITOR" }));
    await screen.findByText("No items to buy.");

    await openMenu(user);
    expect(screen.queryByRole("button", { name: "Delete list" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Members" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Categories" })).toBeInTheDocument();
  });

  it("creates a list from the menu, selects it, and refetches its items", async () => {
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
    await screen.findByTestId("item-row-i1");

    await openMenu(user);
    await user.click(screen.getByRole("button", { name: "New list" }));
    await user.type(screen.getByLabelText("List title"), "Party prep");
    await user.click(screen.getByRole("button", { name: "Create" }));

    const createCall = mock.callsTo("POST", "/api/lists")[0];
    expect(createCall?.body).toEqual({ title: "Party prep" });
    expect(screen.queryByTestId("menu-overlay")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Party prep" })).toBeInTheDocument();
    await waitFor(() => expect(mock.callsTo("GET", "/api/lists/l3/items")).toHaveLength(1));
  });

  it("blocks creating a list with an empty title", async () => {
    const mock = createApiFetchMock();
    stubDefaultRoutes(mock);
    mock.stub();
    const user = userEvent.setup();

    renderPage();
    await screen.findByTestId("item-row-i1");

    await openMenu(user);
    await user.click(screen.getByRole("button", { name: "New list" }));
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(mock.callsTo("POST", "/api/lists")).toHaveLength(0);
    // The menu stays open so the user can retry.
    expect(screen.getByTestId("menu-overlay")).toBeInTheDocument();
  });

  it("navigates to Categories and Members from the menu with the per-list role state", async () => {
    const mock = createApiFetchMock();
    stubDefaultRoutes(mock);
    mock.stub();
    const user = userEvent.setup();

    renderPageWithRoutes();
    await screen.findByTestId("item-row-i1");

    await openMenu(user);
    await user.click(screen.getByRole("button", { name: "Categories" }));
    expect(screen.getByText('categories-page:{"role":"OWNER"}')).toBeInTheDocument();
  });

  it("shows the Members menu row for OWNER lists and navigates with the role state", async () => {
    const mock = createApiFetchMock();
    stubDefaultRoutes(mock);
    mock.stub();
    const user = userEvent.setup();

    renderPageWithRoutes();
    await screen.findByTestId("item-row-i1");

    await openMenu(user);
    await user.click(screen.getByRole("button", { name: "Members" }));
    expect(screen.getByText('members-page:{"role":"OWNER"}')).toBeInTheDocument();
  });

  it("shows the admin block with Users management for admins only and navigates to /users", async () => {
    const mock = createApiFetchMock();
    stubDefaultRoutes(mock); // admin session
    mock.stub();
    const user = userEvent.setup();

    renderPageWithRoutes();
    await screen.findByTestId("item-row-i1");

    await openMenu(user);
    await user.click(screen.getByRole("button", { name: "Users management" }));
    expect(screen.getByText("users-page:{}")).toBeInTheDocument();
  });

  it("hides the admin block for non-admin users", async () => {
    const mock = createApiFetchMock();
    stubDefaultRoutes(mock, { role: "user" });
    mock.stub();
    const user = userEvent.setup();

    renderPage();
    await screen.findByTestId("item-row-i1");

    await openMenu(user);
    expect(screen.queryByRole("button", { name: "Users management" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Admin tools" })).not.toBeInTheDocument();
  });

  it("signs out from the menu", async () => {
    const mock = createApiFetchMock();
    stubDefaultRoutes(mock);
    mock.stub();
    const user = userEvent.setup();

    renderPage();
    await screen.findByTestId("item-row-i1");

    await openMenu(user);
    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(mock.callsTo("POST", "/api/auth/logout")).toHaveLength(1);
  });

  it("falls back to the app name in the header when no list exists", async () => {
    const mock = createApiFetchMock();
    mock.on("POST", "/api/auth/refresh", () => json(200, { accessToken: "token-1", user: USER }));
    mock.on("GET", "/api/lists", () => json(200, []));
    mock.stub();
    const user = userEvent.setup();

    renderPage();

    expect(await screen.findByRole("heading", { name: "My Groceries" })).toBeInTheDocument();
    expect(await screen.findByText("No lists yet — create one from the menu.")).toBeInTheDocument();

    // The menu still works without a selected list: account + create only.
    await openMenu(user);
    expect(screen.getByText("No lists yet — create one below.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New list" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Categories" })).not.toBeInTheDocument();
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
