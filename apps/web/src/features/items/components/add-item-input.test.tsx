import type { Item } from "@grocery/shared";
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { createApiFetchMock, json } from "../../../test/mock-api";
import "../../../test/setup";
import { ListsPage } from "../../lists/pages/lists-page";
import { SUGGEST_DEBOUNCE_MS } from "../hooks/use-suggestions";
import { AddItemInput } from "./add-item-input";

const DAIRY = { id: "c1", title: "Dairy", color: "#3B82F6" };
const BAKERY = { id: "c2", title: "Bakery", color: "#F59E0B" };
const OTHER = { id: "c0", title: "Other", color: "#6B7280" };
const ADDED_AT = "2026-09-27T10:00:00.000Z";
const USER = { id: "u1", email: "alex@example.com", role: "admin" } as const;
const LISTS = [{ id: "l1", title: "Weekly", role: "OWNER", itemCounts: { toBuy: 1, bought: 1 } }];

function item(partial: Partial<Item> & Pick<Item, "id" | "title" | "status">): Item {
  return {
    qtyText: null,
    sortOrder: 0,
    addedAt: ADDED_AT,
    daysInList: 0,
    category: OTHER,
    imageFilename: null,
    currentPrice: null,
    ...partial,
  };
}

const SUGGESTIONS = {
  groups: [
    {
      category: DAIRY,
      items: [
        { id: "i1", title: "Milk", qtyText: "2x", status: "TO_BUY" },
        { id: "i2", title: "Buttermilk", qtyText: null, status: "BOUGHT" },
      ],
    },
    {
      category: BAKERY,
      items: [{ id: "i3", title: "Milk roll", qtyText: null, status: "TO_BUY" }],
    },
  ],
};

function renderBox(listId = "l1") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AddItemInput listId={listId} />
    </QueryClientProvider>,
  );
}

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

/** Raw fetch URLs (the shared mock records only the pathname — query params live here). */
function rawFetchUrls(): string[] {
  return vi.mocked(globalThis.fetch).mock.calls.map((call) => String(call[0]));
}

describe("AddItemInput (docs/TASKS.md → T17)", () => {
  it("debounces suggestions and shows grouped matches with color bars for 'mi' (DoD)", async () => {
    const mock = createApiFetchMock();
    mock.on("GET", "/api/items/suggest", () => json(200, SUGGESTIONS));
    mock.stub();
    const user = userEvent.setup();

    renderBox();
    // Both keystrokes land inside one 200 ms window → exactly one request.
    await user.type(screen.getByLabelText("Add item"), "mi");

    // Not yet debounced — typing finished a moment ago.
    expect(mock.callsTo("GET", "/api/items/suggest")).toHaveLength(0);

    await waitFor(() => expect(mock.callsTo("GET", "/api/items/suggest")).toHaveLength(1));
    const url = rawFetchUrls().find((candidate) => candidate.includes("/api/items/suggest"));
    expect(url).toContain("q=mi");
    expect(url).toContain("listId=l1");

    expect(await screen.findByTestId("suggestion-i1")).toHaveTextContent("Milk");
    expect(screen.getByTestId("suggestion-i2")).toHaveTextContent("Buttermilk");
    expect(screen.getByTestId("suggestion-i3")).toHaveTextContent("Milk roll");
    expect(screen.getByTestId("suggestion-i2")).toHaveTextContent("bought");
    expect(screen.getByText("Dairy")).toBeInTheDocument();
    expect(screen.getByText("Bakery")).toBeInTheDocument();
    // Grouped rows carry the category color as their left bar (docs/PROJECT.md → UX).
    expect(
      screen.getByTestId("suggestion-i1").querySelector("span[aria-hidden='true']"),
    ).toHaveStyle({ backgroundColor: "#3B82F6" });
    expect(
      screen.getByTestId("suggestion-i3").querySelector("span[aria-hidden='true']"),
    ).toHaveStyle({ backgroundColor: "#F59E0B" });
  });

  it("does not fetch suggestions for blank input and keeps Add disabled", async () => {
    const mock = createApiFetchMock();
    mock.stub();
    const user = userEvent.setup();

    renderBox();
    await user.type(screen.getByLabelText("Add item"), "   ");
    // Wait past the debounce window: whitespace-only stays disabled and never fetches.
    await new Promise((resolve) => setTimeout(resolve, SUGGEST_DEBOUNCE_MS + 100));

    expect(mock.calls).toHaveLength(0);
    expect(screen.queryByRole("list", { name: "Suggestions" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
  });

  it("selecting a bought suggestion re-activates it via smart-add (DoD)", async () => {
    const mock = createApiFetchMock();
    mock.on("GET", "/api/items/suggest", () => json(200, SUGGESTIONS));
    mock.on("POST", "/api/lists/l1/items/smart-add", () =>
      json(200, {
        created: false,
        matchedBy: "exact",
        item: item({ id: "i2", title: "Buttermilk", status: "TO_BUY", category: DAIRY }),
      }),
    );
    mock.stub();
    const user = userEvent.setup();

    renderBox();
    await user.type(screen.getByLabelText("Add item"), "mi");
    await screen.findByTestId("suggestion-i2");

    await user.click(screen.getByTestId("suggestion-i2"));

    await waitFor(() =>
      expect(mock.callsTo("POST", "/api/lists/l1/items/smart-add")).toHaveLength(1),
    );
    expect(mock.callsTo("POST", "/api/lists/l1/items/smart-add")[0]?.body).toEqual({
      text: "Buttermilk",
    });
    await waitFor(() => expect(screen.getByLabelText("Add item")).toHaveValue(""));
    expect(screen.queryByTestId("suggestion-i2")).not.toBeInTheDocument();
  });

  it("unknown text creates an item in Other via smart-add on submit (DoD)", async () => {
    const mock = createApiFetchMock();
    mock.on("GET", "/api/items/suggest", () => json(200, { groups: [] }));
    mock.on("POST", "/api/lists/l1/items/smart-add", () =>
      json(201, {
        created: true,
        matchedBy: "created",
        item: item({ id: "i9", title: "Unheard of thing", status: "TO_BUY", category: OTHER }),
      }),
    );
    mock.stub();
    const user = userEvent.setup();

    renderBox();
    await user.type(screen.getByLabelText("Add item"), "Unheard of thing");
    // Submit path of the form (jsdom has no implicit Enter submission).
    fireEvent.submit(screen.getByLabelText("Add item").closest("form") as HTMLFormElement);

    await waitFor(() =>
      expect(mock.callsTo("POST", "/api/lists/l1/items/smart-add")).toHaveLength(1),
    );
    expect(mock.callsTo("POST", "/api/lists/l1/items/smart-add")[0]?.body).toEqual({
      text: "Unheard of thing",
    });
    await waitFor(() => expect(screen.getByLabelText("Add item")).toHaveValue(""));
    expect(screen.queryByRole("list", { name: "Suggestions" })).not.toBeInTheDocument();
  });

  it("shows an error and keeps the text when smart-add fails", async () => {
    const mock = createApiFetchMock();
    mock.on("GET", "/api/items/suggest", () => json(200, { groups: [] }));
    mock.on("POST", "/api/lists/l1/items/smart-add", () =>
      json(500, { error: { code: "INTERNAL_ERROR", message: "boom" } }),
    );
    mock.stub();
    const user = userEvent.setup();

    renderBox();
    await user.type(screen.getByLabelText("Add item"), "Something new");
    fireEvent.submit(screen.getByLabelText("Add item").closest("form") as HTMLFormElement);

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not add the item.");
    expect(screen.getByLabelText("Add item")).toHaveValue("Something new");
  });

  it("renders the pinned bottom input on the main screen; smart-add refreshes lists + items (DoD)", async () => {
    const mock = createApiFetchMock();
    mock.on("POST", "/api/auth/refresh", () => json(200, { accessToken: "token-1", user: USER }));
    mock.on("GET", "/api/lists", () => json(200, LISTS));
    mock.on("GET", "/api/lists/l1/items", () =>
      json(200, {
        items: [item({ id: "i1", title: "Milk", status: "TO_BUY", category: DAIRY })],
      }),
    );
    mock.on("GET", "/api/items/suggest", () => json(200, SUGGESTIONS));
    mock.on("POST", "/api/lists/l1/items/smart-add", () =>
      json(200, {
        created: false,
        matchedBy: "exact",
        item: item({ id: "i1", title: "Milk", status: "TO_BUY", category: DAIRY }),
      }),
    );
    mock.stub();
    const user = userEvent.setup();

    renderPage();

    const bar = await screen.findByTestId("add-item-bar");
    expect(bar.className).toContain("fixed");
    expect(bar.className).toContain("bottom-0");

    await user.type(screen.getByLabelText("Add item"), "mi");
    await screen.findByTestId("suggestion-i1");
    expect(mock.callsTo("GET", "/api/items/suggest")).toHaveLength(1);

    await user.click(screen.getByTestId("suggestion-i1"));

    await waitFor(() =>
      expect(mock.callsTo("POST", "/api/lists/l1/items/smart-add")).toHaveLength(1),
    );
    // The invalidation refreshes both the list counts and the item list.
    await waitFor(() => expect(mock.callsTo("GET", "/api/lists")).toHaveLength(2));
    await waitFor(() => expect(mock.callsTo("GET", "/api/lists/l1/items")).toHaveLength(2));
  });
});
