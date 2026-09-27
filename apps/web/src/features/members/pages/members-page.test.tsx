import type { ListDetail, ListRole, ListSummary } from "@grocery/shared";
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { App } from "../../../app";
import { type MockResponseSpec, createApiFetchMock, json } from "../../../test/mock-api";
import "../../../test/setup";
import { MembersPage } from "./members-page";

const USER = { id: "u1", email: "alex@example.com", role: "admin" } as const;
const LISTS: ListSummary[] = [
  { id: "l1", title: "Weekly", role: "OWNER", itemCounts: { toBuy: 0, bought: 0 } },
  { id: "l2", title: "Party", role: "EDITOR", itemCounts: { toBuy: 0, bought: 0 } },
];

function initialWorld(): ListDetail {
  return {
    id: "l1",
    title: "Weekly",
    owner: { id: "u1", email: "alex@example.com" },
    members: [
      { userId: "u1", email: "alex@example.com", role: "OWNER" },
      { userId: "u2", email: "mom@example.com", role: "VIEWER" },
    ],
  };
}

/** Stubs the members endpoints of list l1 against a mutable detail world. */
function stubWorld(mock: ReturnType<typeof createApiFetchMock>, world: ListDetail): void {
  mock.on("POST", "/api/auth/refresh", () => json(200, { accessToken: "token-1", user: USER }));
  mock.on("GET", "/api/lists", () => json(200, LISTS));
  mock.on("GET", "/api/lists/l1", () => json(200, world));
  mock.on("POST", "/api/lists/l1/members", ({ body }): MockResponseSpec => {
    const request = body as { email: string; role: string };
    if (request.email === "mom2@example.com") {
      world.members = [...world.members, { userId: "u3", email: request.email, role: "EDITOR" }];
      return json(201, { userId: "u3", email: request.email, role: "EDITOR" });
    }
    return json(404, { error: { code: "NOT_FOUND", message: "No user with this email" } });
  });
  mock.on("PATCH", "/api/lists/l1/members/u2", ({ body }): MockResponseSpec => {
    const request = body as { role: string };
    world.members = world.members.map((member) =>
      member.userId === "u2" ? { ...member, role: request.role as ListRole } : member,
    );
    return json(200, { userId: "u2", email: "mom@example.com", role: request.role });
  });
  mock.on("DELETE", "/api/lists/l1/members/u2", (): MockResponseSpec => {
    world.members = world.members.filter((member) => member.userId !== "u2");
    return json(204);
  });
}

function renderPage(stateRole?: string): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={[
          { pathname: "/lists/l1/members", state: stateRole ? { role: stateRole } : undefined },
        ]}
      >
        <Routes>
          <Route path="/lists/:listId/members" element={<MembersPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("MembersPage (docs/TASKS.md → T20)", () => {
  it("renders members with email and role; the list owner's row is read-only", async () => {
    const mock = createApiFetchMock();
    stubWorld(mock, initialWorld());
    mock.stub();

    renderPage("OWNER");

    expect(await screen.findByTestId("member-row-u1")).toBeInTheDocument();
    expect(screen.getByTestId("member-row-u2")).toBeInTheDocument();
    expect(screen.getByText("alex@example.com")).toBeInTheDocument();
    expect(screen.getByText("List owner")).toBeInTheDocument();
    // The owner row has a badge but no role select and no remove button.
    expect(screen.getByText("Owner", { selector: "span" })).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "Role for alex@example.com" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Remove alex@example.com" }),
    ).not.toBeInTheDocument();
    // The member row has both.
    expect(screen.getByRole("combobox", { name: "Role for mom@example.com" })).toHaveValue(
      "VIEWER",
    );
    expect(screen.getByRole("button", { name: "Remove mom@example.com" })).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Add member" })).toBeInTheDocument();
  });

  it("shows the empty hint when the list has no members besides the owner", async () => {
    const mock = createApiFetchMock();
    const world = initialWorld();
    world.members = [{ userId: "u1", email: "alex@example.com", role: "OWNER" }];
    stubWorld(mock, world);
    mock.stub();

    renderPage("OWNER");

    expect(await screen.findByTestId("member-row-u1")).toBeInTheDocument();
    expect(screen.getByText("No members yet — add one by email above.")).toBeInTheDocument();
  });

  it("EDITOR cannot open it (DoD): notice instead of the editor, member data never fetched", async () => {
    const mock = createApiFetchMock();
    stubWorld(mock, initialWorld());
    mock.stub();

    renderPage("EDITOR");

    expect(await screen.findByText("Only the list owner can manage members.")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Add member" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("member-row-u2")).not.toBeInTheDocument();
    expect(mock.callsTo("GET", "/api/lists/l1")).toHaveLength(0);
  });

  it("VIEWER cannot open it via deep link (role resolved from the lists cache)", async () => {
    const mock = createApiFetchMock();
    const world = initialWorld();
    world.members = [
      { userId: "u2", email: "mom@example.com", role: "OWNER" },
      { userId: "u1", email: "alex@example.com", role: "VIEWER" },
    ];
    stubWorld(mock, world);
    mock.on("GET", "/api/lists", () =>
      json(200, [
        { id: "l1", title: "Weekly", role: "VIEWER", itemCounts: { toBuy: 0, bought: 0 } },
      ]),
    );
    mock.stub();

    // No navigation state — the role comes from GET /lists (alex is VIEWER here).
    renderPage();

    expect(await screen.findByText("Only the list owner can manage members.")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Add member" })).not.toBeInTheDocument();
    expect(mock.callsTo("GET", "/api/lists/l1")).toHaveLength(0);
  });

  it("tells a non-member the list is not theirs", async () => {
    const mock = createApiFetchMock();
    stubWorld(mock, initialWorld());
    mock.on("GET", "/api/lists", () =>
      json(
        200,
        LISTS.filter((list) => list.id !== "l1"),
      ),
    );
    mock.stub();

    renderPage();

    expect(await screen.findByText("List not found among your lists.")).toBeInTheDocument();
    expect(mock.callsTo("GET", "/api/lists/l1")).toHaveLength(0);
  });

  it("adds a member by email (DoD): POST body, payload refetch, row appears, form clears", async () => {
    const mock = createApiFetchMock();
    const world = initialWorld();
    stubWorld(mock, world);
    mock.stub();
    const user = userEvent.setup();

    renderPage("OWNER");
    await screen.findByTestId("member-row-u2");

    await user.type(screen.getByLabelText("Email"), "Mom2@Example.com");
    await user.click(screen.getByRole("button", { name: "Add member" }));

    expect(mock.callsTo("POST", "/api/lists/l1/members")[0]?.body).toEqual({
      email: "mom2@example.com",
      role: "EDITOR",
    });
    // The members payload is refetched and reflects the change.
    await waitFor(() => expect(mock.callsTo("GET", "/api/lists/l1")).toHaveLength(2));
    expect(await screen.findByTestId("member-row-u3")).toBeInTheDocument();
    expect(screen.getByText("mom2@example.com")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveValue("");
  });

  it("shows a friendly error when adding an email without an account (404)", async () => {
    const mock = createApiFetchMock();
    stubWorld(mock, initialWorld());
    mock.stub();
    const user = userEvent.setup();

    renderPage("OWNER");
    await screen.findByTestId("member-row-u2");

    await user.type(screen.getByLabelText("Email"), "stranger@example.com");
    await user.click(screen.getByRole("button", { name: "Add member" }));

    expect(
      await screen.findByText("No user with this email has an account yet."),
    ).toBeInTheDocument();
    // No invalidation without success: the payload is fetched exactly once.
    expect(mock.callsTo("GET", "/api/lists/l1")).toHaveLength(1);
    expect(screen.getByTestId("member-row-u2")).toBeInTheDocument();
  });

  it("shows a friendly error when adding an existing member (409)", async () => {
    const mock = createApiFetchMock();
    stubWorld(mock, initialWorld());
    mock.on("POST", "/api/lists/l1/members", () =>
      json(409, { error: { code: "CONFLICT", message: "already a member" } }),
    );
    mock.stub();
    const user = userEvent.setup();

    renderPage("OWNER");
    await screen.findByTestId("member-row-u2");

    await user.type(screen.getByLabelText("Email"), "mom@example.com");
    await user.click(screen.getByRole("button", { name: "Add member" }));

    expect(
      await screen.findByText("This user is already a member of the list."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("member-row-u2")).toBeInTheDocument();
  });

  it("blocks an empty email client-side without calling the API", async () => {
    const mock = createApiFetchMock();
    stubWorld(mock, initialWorld());
    mock.stub();
    const user = userEvent.setup();

    renderPage("OWNER");
    await screen.findByRole("form", { name: "Add member" });

    await user.click(screen.getByRole("button", { name: "Add member" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(mock.callsTo("POST", "/api/lists/l1/members")).toHaveLength(0);
  });

  it("changes a member's role (DoD): PATCH body, payload refetch reflects the new role", async () => {
    const mock = createApiFetchMock();
    const world = initialWorld();
    stubWorld(mock, world);
    mock.stub();
    const user = userEvent.setup();

    renderPage("OWNER");
    await screen.findByTestId("member-row-u2");

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Role for mom@example.com" }),
      "EDITOR",
    );

    expect(mock.callsTo("PATCH", "/api/lists/l1/members/u2")[0]?.body).toEqual({ role: "EDITOR" });
    await waitFor(() => expect(mock.callsTo("GET", "/api/lists/l1")).toHaveLength(2));
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Role for mom@example.com" })).toHaveValue(
        "EDITOR",
      ),
    );
    expect(screen.getByText("Editor", { selector: "span" })).toBeInTheDocument();
  });

  it("removes a member (DoD): DELETE, payload refetch, row disappears", async () => {
    const mock = createApiFetchMock();
    const world = initialWorld();
    stubWorld(mock, world);
    mock.stub();
    const user = userEvent.setup();

    renderPage("OWNER");
    await screen.findByTestId("member-row-u2");

    await user.click(screen.getByRole("button", { name: "Remove mom@example.com" }));

    expect(mock.callsTo("DELETE", "/api/lists/l1/members/u2")).toHaveLength(1);
    await waitFor(() => expect(mock.callsTo("GET", "/api/lists/l1")).toHaveLength(2));
    await waitFor(() => expect(screen.queryByTestId("member-row-u2")).not.toBeInTheDocument());
    expect(screen.getByText("No members yet — add one by email above.")).toBeInTheDocument();
  });

  it("shows an error and keeps the row when removing fails", async () => {
    const mock = createApiFetchMock();
    stubWorld(mock, initialWorld());
    mock.on("DELETE", "/api/lists/l1/members/u2", () =>
      json(404, { error: { code: "NOT_FOUND", message: "gone" } }),
    );
    mock.stub();
    const user = userEvent.setup();

    renderPage("OWNER");
    await screen.findByTestId("member-row-u2");

    await user.click(screen.getByRole("button", { name: "Remove mom@example.com" }));

    expect(
      await screen.findByText("Could not remove the member. Please try again."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("member-row-u2")).toBeInTheDocument();
  });

  it("shows an error state when loading the members fails", async () => {
    const mock = createApiFetchMock();
    mock.on("POST", "/api/auth/refresh", () => json(200, { accessToken: "token-1", user: USER }));
    mock.on("GET", "/api/lists", () => json(200, LISTS));
    mock.on("GET", "/api/lists/l1", () =>
      json(500, { error: { code: "INTERNAL_ERROR", message: "boom" } }),
    );
    mock.stub();

    renderPage("OWNER");

    expect(await screen.findByText("Could not load the members.")).toBeInTheDocument();
  });
});

describe("T20 Definition of Done: entry point is OWNER-only end to end", () => {
  it("the main screen offers Members for an OWNER list; the editor works from there", async () => {
    const mock = createApiFetchMock();
    const world = initialWorld();
    stubWorld(mock, world);
    mock.on("GET", "/api/lists/l1/items", () => json(200, { items: [] }));
    mock.stub();
    const user = userEvent.setup();

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={["/"]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole("button", { name: "Members" }));
    expect(await screen.findByTestId("member-row-u2")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Email"), "mom2@example.com");
    await user.click(screen.getByRole("button", { name: "Add member" }));

    expect(await screen.findByTestId("member-row-u3")).toBeInTheDocument();
    expect(mock.callsTo("GET", "/api/lists/l1")).toHaveLength(2);
  });

  it("the main screen offers no Members button for a list where the user is EDITOR", async () => {
    const mock = createApiFetchMock();
    stubWorld(mock, initialWorld());
    mock.on("GET", "/api/lists/l1/items", () => json(200, { items: [] }));
    mock.on("GET", "/api/lists/l2/items", () => json(200, { items: [] }));
    mock.stub();
    const user = userEvent.setup();

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={["/"]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("button", { name: "Members" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Party" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Members" })).not.toBeInTheDocument(),
    );
  });
});
