import type { Item, SuggestGroup } from "@grocery/shared";
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { createApiFetchMock, json } from "../../../test/mock-api";
import "../../../test/setup";
import { ListsPage } from "../../lists/pages/lists-page";
import { SUGGEST_DEBOUNCE_MS } from "../hooks/use-suggestions";
import { AddItemInput, MAX_VISIBLE_SUGGESTIONS, capSuggestionGroups } from "./add-item-input";

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

describe("AddItemInput explicit create (docs/TASKS.md → T26)", () => {
  /** The server suggests "Watermelon" for "melon" (substring both ways) — exactly the
   * bug report's setup: suggestions exist, but they must not be the only way forward. */
  const WATERMELON_GROUP = {
    groups: [
      {
        category: OTHER,
        items: [{ id: "i10", title: "Watermelon", qtyText: null, status: "TO_BUY" }],
      },
    ],
  };

  it("'melon' next to existing 'watermelon': the Create row makes a separate item via plain POST (DoD)", async () => {
    const mock = createApiFetchMock();
    mock.on("GET", "/api/items/suggest", () => json(200, WATERMELON_GROUP));
    mock.on("POST", "/api/lists/l1/items", () =>
      json(201, item({ id: "i11", title: "melon", status: "TO_BUY", category: OTHER })),
    );
    mock.stub();
    const user = userEvent.setup();

    renderBox();
    await user.type(screen.getByLabelText("Add item"), "melon");
    expect(await screen.findByTestId("suggestion-i10")).toHaveTextContent("Watermelon");
    const createRow = screen.getByTestId("create-item-row");
    expect(createRow).toHaveTextContent('Create "melon"');

    await user.click(createRow);

    // Plain create — smart-add would fuzzy-match "watermelon" (Dice ≥ 0.6) instead.
    expect(mock.callsTo("POST", "/api/lists/l1/items/smart-add")).toHaveLength(0);
    await waitFor(() => expect(mock.callsTo("POST", "/api/lists/l1/items")).toHaveLength(1));
    expect(mock.callsTo("POST", "/api/lists/l1/items")[0]?.body).toEqual({ title: "melon" });
    await waitFor(() => expect(screen.getByLabelText("Add item")).toHaveValue(""));
    expect(screen.queryByTestId("create-item-row")).not.toBeInTheDocument();
  });

  it("re-adding an exact title still re-activates via smart-add on submit (DoD)", async () => {
    const mock = createApiFetchMock();
    mock.on("GET", "/api/items/suggest", () =>
      json(200, {
        groups: [
          {
            category: OTHER,
            items: [{ id: "i10", title: "Watermelon", qtyText: null, status: "BOUGHT" }],
          },
        ],
      }),
    );
    mock.on("POST", "/api/lists/l1/items/smart-add", () =>
      json(200, {
        created: false,
        matchedBy: "exact",
        item: item({ id: "i10", title: "Watermelon", status: "TO_BUY", category: OTHER }),
      }),
    );
    mock.stub();
    const user = userEvent.setup();

    renderBox();
    await user.type(screen.getByLabelText("Add item"), "Watermelon");
    await screen.findByTestId("suggestion-i10");
    // Enter path of the form (jsdom has no implicit Enter submission).
    fireEvent.submit(screen.getByLabelText("Add item").closest("form") as HTMLFormElement);

    await waitFor(() =>
      expect(mock.callsTo("POST", "/api/lists/l1/items/smart-add")).toHaveLength(1),
    );
    expect(mock.callsTo("POST", "/api/lists/l1/items/smart-add")[0]?.body).toEqual({
      text: "Watermelon",
    });
    // Enter keeps the smart-add semantics — it must not duplicate the item.
    expect(mock.callsTo("POST", "/api/lists/l1/items")).toHaveLength(0);
    await waitFor(() => expect(screen.getByLabelText("Add item")).toHaveValue(""));
  });

  it("duplicate creation works: the same name can be created twice (DoD)", async () => {
    const mock = createApiFetchMock();
    mock.on("GET", "/api/items/suggest", () => json(200, { groups: [] }));
    mock.on("POST", "/api/lists/l1/items", () =>
      json(201, item({ id: "i11", title: "Watermelon", status: "TO_BUY", category: OTHER })),
    );
    mock.stub();
    const user = userEvent.setup();

    renderBox();
    const input = screen.getByLabelText("Add item");
    await user.type(input, "Watermelon");
    await user.click(screen.getByTestId("create-item-row"));
    await waitFor(() => expect(mock.callsTo("POST", "/api/lists/l1/items")).toHaveLength(1));

    // The first "Watermelon" now exists (an exact suggestion) — the Create row must
    // stay available so the second, separate item can still be added.
    await user.type(input, "Watermelon");
    await user.click(screen.getByTestId("create-item-row"));

    await waitFor(() => expect(mock.callsTo("POST", "/api/lists/l1/items")).toHaveLength(2));
    for (const call of mock.callsTo("POST", "/api/lists/l1/items")) {
      expect(call.body).toEqual({ title: "Watermelon" });
    }
  });

  it("keeps the Create row hidden while the input is blank", async () => {
    const mock = createApiFetchMock();
    mock.stub();
    const user = userEvent.setup();

    renderBox();
    expect(screen.queryByTestId("create-item-row")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Add item"), "   ");
    await new Promise((resolve) => setTimeout(resolve, SUGGEST_DEBOUNCE_MS + 100));

    expect(screen.queryByTestId("create-item-row")).not.toBeInTheDocument();
    expect(mock.calls).toHaveLength(0);
  });

  it("shows an error and keeps the text when the explicit create fails", async () => {
    const mock = createApiFetchMock();
    mock.on("GET", "/api/items/suggest", () => json(200, { groups: [] }));
    mock.on("POST", "/api/lists/l1/items", () =>
      json(403, { error: { code: "FORBIDDEN", message: "viewer" } }),
    );
    mock.stub();
    const user = userEvent.setup();

    renderBox();
    await user.type(screen.getByLabelText("Add item"), "melon");
    await user.click(screen.getByTestId("create-item-row"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not add the item.");
    expect(screen.getByLabelText("Add item")).toHaveValue("melon");
    // The row stays reachable so the user can retry.
    expect(screen.getByTestId("create-item-row")).toBeInTheDocument();
  });

  it("creating from the main screen refreshes the list's items and counts", async () => {
    const mock = createApiFetchMock();
    mock.on("POST", "/api/auth/refresh", () => json(200, { accessToken: "token-1", user: USER }));
    mock.on("GET", "/api/lists", () => json(200, LISTS));
    mock.on("GET", "/api/lists/l1/items", () =>
      json(200, {
        items: [item({ id: "i10", title: "Watermelon", status: "TO_BUY", category: OTHER })],
      }),
    );
    mock.on("GET", "/api/items/suggest", () => json(200, WATERMELON_GROUP));
    mock.on("POST", "/api/lists/l1/items", () =>
      json(201, item({ id: "i11", title: "melon", status: "TO_BUY", category: OTHER })),
    );
    mock.stub();
    const user = userEvent.setup();

    renderPage();
    await screen.findByTestId("add-item-bar");

    await user.type(screen.getByLabelText("Add item"), "melon");
    await user.click(await screen.findByTestId("create-item-row"));

    await waitFor(() => expect(mock.callsTo("POST", "/api/lists/l1/items")).toHaveLength(1));
    // The invalidation refreshes both the item list and the list counts.
    await waitFor(() => expect(mock.callsTo("GET", "/api/lists/l1/items")).toHaveLength(2));
    await waitFor(() => expect(mock.callsTo("GET", "/api/lists")).toHaveLength(2));
  });
});

describe("AddItemInput suggestions popover (docs/TASKS.md → T29)", () => {
  const color = (id: string, title: string) => ({ id, title, color: "#3B82F6" });

  describe("capSuggestionGroups (pure)", () => {
    const groups: SuggestGroup[] = [
      {
        category: color("c1", "Dairy"),
        items: [
          { id: "i1", title: "Milk", qtyText: null, status: "TO_BUY" },
          { id: "i2", title: "Buttermilk", qtyText: null, status: "TO_BUY" },
        ],
      },
      {
        category: color("c2", "Bakery"),
        items: [
          { id: "i3", title: "Roll", qtyText: null, status: "TO_BUY" },
          { id: "i4", title: "Toast", qtyText: null, status: "TO_BUY" },
        ],
      },
      { category: color("c3", "Empty"), items: [] },
    ];

    it("caps the flat item count across groups, cutting mid-group in server order", () => {
      const capped = capSuggestionGroups(groups, 3);
      expect(capped.map((group) => group.items.map((item) => item.id))).toEqual([
        ["i1", "i2"],
        ["i3"],
      ]);
    });

    it("skips empty groups and passes an exact fit through", () => {
      expect(capSuggestionGroups(groups, 2).map((group) => group.category.id)).toEqual(["c1"]);
      expect(capSuggestionGroups(groups, 4).map((group) => group.items.length)).toEqual([2, 2]);
      expect(capSuggestionGroups(groups, 0)).toEqual([]);
    });

    it("matches the exported cap", () => {
      expect(MAX_VISIBLE_SUGGESTIONS).toBe(3);
    });
  });

  /** Server payload with 5 matches across 2 categories — more than the popover may show. */
  const FIVE_MATCHES = {
    groups: [
      {
        category: DAIRY,
        items: [
          { id: "i1", title: "Milk", qtyText: null, status: "TO_BUY" },
          { id: "i2", title: "Buttermilk", qtyText: null, status: "TO_BUY" },
          { id: "i3", title: "Milkshake", qtyText: null, status: "TO_BUY" },
        ],
      },
      {
        category: BAKERY,
        items: [
          { id: "i4", title: "Milk roll", qtyText: null, status: "TO_BUY" },
          { id: "i5", title: "Oat milk bun", qtyText: null, status: "TO_BUY" },
        ],
      },
    ],
  };

  it("shows at most 3 suggestions in the floating layer above the input, which stays pinned (DoD)", async () => {
    const mock = createApiFetchMock();
    mock.on("GET", "/api/items/suggest", () => json(200, FIVE_MATCHES));
    mock.stub();
    const user = userEvent.setup();

    renderBox();
    await user.type(screen.getByLabelText("Add item"), "mi");
    const popover = await screen.findByTestId("suggestions-popover");
    // The popover appears instantly on typing — wait for the debounced rows too.
    await screen.findByTestId("suggestion-i3");

    // Cap: only the first 3 rows exist, the rest are trimmed client-side.
    expect(screen.getByTestId("suggestion-i1")).toBeInTheDocument();
    expect(screen.getByTestId("suggestion-i2")).toBeInTheDocument();
    expect(screen.getByTestId("suggestion-i3")).toBeInTheDocument();
    expect(screen.queryByTestId("suggestion-i4")).not.toBeInTheDocument();
    expect(screen.queryByTestId("suggestion-i5")).not.toBeInTheDocument();
    expect(within(popover).getAllByRole("button")).toHaveLength(3 + 1); // suggestions + Create row

    // Floating layer: absolutely positioned, anchored above the input (out of
    // the layout flow — jsdom has no layout, so the anchoring classes plus the
    // input's placement outside the popover are the structural contract here).
    expect(popover.className).toContain("absolute");
    expect(popover.className).toContain("bottom-full");
    expect(screen.getByTestId("add-item-box").className).toContain("relative");
    expect(
      popover.compareDocumentPosition(screen.getByLabelText("Add item")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy(); // popover rendered before the input
    expect(popover.contains(screen.getByLabelText("Add item"))).toBe(false);
    // The T26 Create row lives inside the same floating layer.
    expect(popover).toContainElement(screen.getByTestId("create-item-row"));
    // ≥ 40 px tap targets (min-h-11 = 44 px).
    expect(screen.getByTestId("suggestion-i1").className).toContain("min-h-11");
    expect(screen.getByTestId("create-item-row").className).toContain("min-h-11");
  });

  it("Escape closes the popover; typing again reopens it (DoD)", async () => {
    const mock = createApiFetchMock();
    mock.on("GET", "/api/items/suggest", () => json(200, FIVE_MATCHES));
    mock.stub();
    const user = userEvent.setup();

    renderBox();
    const input = screen.getByLabelText("Add item");
    await user.type(input, "mi");
    await screen.findByTestId("suggestions-popover");

    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("suggestions-popover")).not.toBeInTheDocument();
    expect(screen.queryByTestId("create-item-row")).not.toBeInTheDocument();
    expect(input).toHaveValue("mi");

    // A new keystroke reopens the layer.
    await user.type(input, "l");
    expect(await screen.findByTestId("suggestions-popover")).toBeInTheDocument();
  });

  it("blur outside the box closes the popover (DoD: dismiss by tap)", async () => {
    const mock = createApiFetchMock();
    mock.on("GET", "/api/items/suggest", () => json(200, FIVE_MATCHES));
    mock.stub();
    const user = userEvent.setup();

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <div>
          <AddItemInput listId="l1" />
          <button type="button">Elsewhere</button>
        </div>
      </QueryClientProvider>,
    );

    await user.type(screen.getByLabelText("Add item"), "mi");
    await screen.findByTestId("suggestions-popover");

    await user.click(screen.getByRole("button", { name: "Elsewhere" }));
    expect(screen.queryByTestId("suggestions-popover")).not.toBeInTheDocument();
  });

  it("selecting and creating by tap still work from the floating layer", async () => {
    const mock = createApiFetchMock();
    mock.on("GET", "/api/items/suggest", () => json(200, FIVE_MATCHES));
    mock.on("POST", "/api/lists/l1/items/smart-add", () =>
      json(200, {
        created: false,
        matchedBy: "exact",
        item: item({ id: "i1", title: "Milk", status: "TO_BUY", category: DAIRY }),
      }),
    );
    mock.on("POST", "/api/lists/l1/items", () =>
      json(201, item({ id: "i9", title: "mi thing", status: "TO_BUY", category: OTHER })),
    );
    mock.stub();
    const user = userEvent.setup();

    renderBox();
    const input = screen.getByLabelText("Add item");
    await user.type(input, "mi");
    await screen.findByTestId("suggestions-popover");
    await screen.findByTestId("suggestion-i1");

    await user.click(screen.getByTestId("suggestion-i1"));
    await waitFor(() =>
      expect(mock.callsTo("POST", "/api/lists/l1/items/smart-add")).toHaveLength(1),
    );
    await waitFor(() => expect(input).toHaveValue(""));
    expect(screen.queryByTestId("suggestions-popover")).not.toBeInTheDocument();

    await user.type(input, "mi thing");
    await user.click(await screen.findByTestId("create-item-row"));
    await waitFor(() => expect(mock.callsTo("POST", "/api/lists/l1/items")).toHaveLength(1));
    expect(mock.callsTo("POST", "/api/lists/l1/items")[0]?.body).toEqual({ title: "mi thing" });
  });

  it("a failed create keeps the popover open so the action can be retried", async () => {
    const mock = createApiFetchMock();
    mock.on("GET", "/api/items/suggest", () => json(200, { groups: [] }));
    mock.on("POST", "/api/lists/l1/items", () =>
      json(403, { error: { code: "FORBIDDEN", message: "viewer" } }),
    );
    mock.stub();
    const user = userEvent.setup();

    renderBox();
    await user.type(screen.getByLabelText("Add item"), "melon");
    await user.click(screen.getByTestId("create-item-row"));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByTestId("suggestions-popover")).toBeInTheDocument();
    expect(screen.getByTestId("create-item-row")).toBeInTheDocument();
  });
});
