import type { UserDto } from "@grocery/shared";
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { App } from "../../../app";
import { type MockResponseSpec, createApiFetchMock, json } from "../../../test/mock-api";
import "../../../test/setup";
import { UsersPage } from "./users-page";

const ADMIN = { id: "u1", email: "alex@example.com", role: "admin" } as const;
const MEMBER = { id: "u5", email: "member@grocery.local", role: "user" } as const;

function initialWorld(): UserDto[] {
  return [
    { id: "u1", email: "alex@example.com", role: "admin", createdAt: "2026-09-01T08:00:00.000Z" },
    { id: "u2", email: "mom@example.com", role: "user", createdAt: "2026-09-20T08:00:00.000Z" },
  ];
}

/** Stubs the users endpoints against a mutable user world. */
function stubWorld(mock: ReturnType<typeof createApiFetchMock>, world: UserDto[]): void {
  mock.on("POST", "/api/auth/refresh", () => json(200, { accessToken: "token-1", user: ADMIN }));
  mock.on("GET", "/api/users", () => json(200, world));
  mock.on("POST", "/api/users", ({ body }): MockResponseSpec => {
    const request = body as { email: string; role: string };
    if (world.some((user) => user.email === request.email)) {
      return json(409, {
        error: { code: "CONFLICT", message: `A user with email ${request.email} already exists` },
      });
    }
    const created: UserDto = {
      id: "u3",
      email: request.email,
      role: request.role as UserDto["role"],
      createdAt: "2026-09-27T10:00:00.000Z",
    };
    world.push(created);
    return json(201, created);
  });
  mock.on("DELETE", "/api/users/u2", (): MockResponseSpec => {
    const index = world.findIndex((user) => user.id === "u2");
    if (index >= 0) world.splice(index, 1);
    return json(204);
  });
}

function renderPage(): void {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={["/users"]}>
        <Routes>
          <Route path="/users" element={<UsersPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("UsersPage (docs/TASKS.md → T32)", () => {
  it("renders the user list with email, role, and createdAt plus the create form", async () => {
    const mock = createApiFetchMock();
    stubWorld(mock, initialWorld());
    mock.stub();

    renderPage();

    expect(await screen.findByTestId("user-row-u1")).toBeInTheDocument();
    expect(screen.getByTestId("user-row-u2")).toBeInTheDocument();
    expect(screen.getByText("alex@example.com")).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Create user" })).toBeInTheDocument();
    expect(screen.getByText("Joined 2026-09-01")).toBeInTheDocument();
    expect(screen.getByText("Joined 2026-09-20")).toBeInTheDocument();
    // Role badges: two admins/one user depending on the world — here 1 admin + 1 user.
    expect(screen.getByText("Admin", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("User", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete mom@example.com" })).toBeInTheDocument();
  });

  it("creates a user (DoD): normalized POST body, payload refetch, row appears, form resets", async () => {
    const mock = createApiFetchMock();
    const world = initialWorld();
    stubWorld(mock, world);
    mock.stub();
    const user = userEvent.setup();

    renderPage();
    await screen.findByTestId("user-row-u2");

    await user.type(screen.getByLabelText("Email"), "Mom2@Example.com");
    await user.type(screen.getByLabelText("Password"), "secret");
    await user.selectOptions(screen.getByLabelText("Role"), "admin");
    await user.click(screen.getByRole("button", { name: "Create user" }));

    // The shared schema normalizes the email (trim + lowercase) at the boundary.
    expect(mock.callsTo("POST", "/api/users")[0]?.body).toEqual({
      email: "mom2@example.com",
      password: "secret",
      role: "admin",
    });
    // The user list is refetched and shows the created user.
    await waitFor(() => expect(mock.callsTo("GET", "/api/users")).toHaveLength(2));
    expect(await screen.findByTestId("user-row-u3")).toBeInTheDocument();
    expect(screen.getByText("mom2@example.com")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveValue("");
    expect(screen.getByLabelText("Password")).toHaveValue("");
  });

  it("shows a friendly message on duplicate email (409 DoD) and keeps the form filled", async () => {
    const mock = createApiFetchMock();
    stubWorld(mock, initialWorld());
    mock.stub();
    const user = userEvent.setup();

    renderPage();
    await screen.findByTestId("user-row-u2");

    await user.type(screen.getByLabelText("Email"), "mom@example.com");
    await user.type(screen.getByLabelText("Password"), "secret");
    await user.click(screen.getByRole("button", { name: "Create user" }));

    expect(await screen.findByText("A user with this email already exists.")).toBeInTheDocument();
    // No invalidation without success: the list was fetched exactly once.
    expect(mock.callsTo("GET", "/api/users")).toHaveLength(1);
    expect(screen.getByLabelText("Email")).toHaveValue("mom@example.com");
  });

  it("blocks an empty email/password client-side without calling the API", async () => {
    const mock = createApiFetchMock();
    stubWorld(mock, initialWorld());
    mock.stub();
    const user = userEvent.setup();

    renderPage();
    await screen.findByRole("form", { name: "Create user" });

    await user.click(screen.getByRole("button", { name: "Create user" }));

    expect(await screen.findAllByRole("alert")).toHaveLength(2);
    expect(mock.callsTo("POST", "/api/users")).toHaveLength(0);
  });

  it("deletes a user after confirmation: DELETE, payload refetch, row disappears", async () => {
    const mock = createApiFetchMock();
    const world = initialWorld();
    stubWorld(mock, world);
    mock.stub();
    const user = userEvent.setup();

    renderPage();
    await screen.findByTestId("user-row-u2");

    // Two-step confirm: the first click only asks.
    await user.click(screen.getByRole("button", { name: "Delete mom@example.com" }));
    expect(mock.callsTo("DELETE", "/api/users/u2")).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Confirm delete" }));

    expect(mock.callsTo("DELETE", "/api/users/u2")).toHaveLength(1);
    await waitFor(() => expect(mock.callsTo("GET", "/api/users")).toHaveLength(2));
    await waitFor(() => expect(screen.queryByTestId("user-row-u2")).not.toBeInTheDocument());
  });

  it("shows the owns-lists message when deleting fails with 409 and keeps the row", async () => {
    const mock = createApiFetchMock();
    stubWorld(mock, initialWorld());
    // Override: u2 still owns lists → the server refuses (docs/API.md → Users).
    mock.on("DELETE", "/api/users/u2", () =>
      json(409, {
        error: { code: "CONFLICT", message: "The user owns lists and cannot be deleted" },
      }),
    );
    mock.stub();
    const user = userEvent.setup();

    renderPage();
    await screen.findByTestId("user-row-u2");

    await user.click(screen.getByRole("button", { name: "Delete mom@example.com" }));
    await user.click(screen.getByRole("button", { name: "Confirm delete" }));

    expect(
      await screen.findByText("This user owns lists and cannot be deleted."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("user-row-u2")).toBeInTheDocument();
    expect(mock.callsTo("GET", "/api/users")).toHaveLength(1);
  });

  it("shows an error state when loading the users fails", async () => {
    const mock = createApiFetchMock();
    mock.on("POST", "/api/auth/refresh", () => json(200, { accessToken: "token-1", user: ADMIN }));
    mock.on("GET", "/api/users", () =>
      json(500, { error: { code: "INTERNAL_ERROR", message: "boom" } }),
    );
    mock.stub();

    renderPage();

    expect(await screen.findByText("Could not load the users.")).toBeInTheDocument();
  });

  it("non-admin deep link (DoD): blocked notice, no user data fetched", async () => {
    const mock = createApiFetchMock();
    mock.on("POST", "/api/auth/refresh", () => json(200, { accessToken: "token-1", user: MEMBER }));
    // No /users stubs: any stray fetch would throw and fail the test loudly.
    mock.stub();

    renderPage();

    expect(await screen.findByText("Only admins can manage users.")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Create user" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("user-row-u2")).not.toBeInTheDocument();
    expect(mock.callsTo("GET", "/api/users")).toHaveLength(0);
  });
});

describe("T32 Definition of Done: end to end through the T30 menu", () => {
  it("admin reaches /users from the menu's admin block and creates a user", async () => {
    const mock = createApiFetchMock();
    const world = initialWorld();
    stubWorld(mock, world);
    mock.on("GET", "/api/lists", () => json(200, []));
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

    await user.click(await screen.findByRole("button", { name: "Menu" }));
    await user.click(await screen.findByRole("button", { name: "Users management" }));

    expect(await screen.findByTestId("user-row-u2")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Email"), "newmember@example.com");
    await user.type(screen.getByLabelText("Password"), "secret");
    await user.click(screen.getByRole("button", { name: "Create user" }));

    expect(mock.callsTo("POST", "/api/users")[0]?.body).toEqual({
      email: "newmember@example.com",
      password: "secret",
      role: "user",
    });
    await waitFor(() => expect(mock.callsTo("GET", "/api/users")).toHaveLength(2));
    expect(await screen.findByTestId("user-row-u3")).toBeInTheDocument();
  });

  it("non-admin deep link to /users: blocked notice, zero user API calls, stays on the page", async () => {
    const mock = createApiFetchMock();
    mock.on("POST", "/api/auth/refresh", () => json(200, { accessToken: "token-1", user: MEMBER }));
    // No /users stubs: any stray fetch would throw and fail the test loudly.
    mock.stub();

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={["/users"]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Only admins can manage users.")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Create user" })).not.toBeInTheDocument();
    expect(mock.callsTo("GET", "/api/users")).toHaveLength(0);
    // The RequireAuth guard did not redirect — the page renders its own gate.
    expect(screen.getByRole("heading", { name: "Users" })).toBeInTheDocument();
  });
});
