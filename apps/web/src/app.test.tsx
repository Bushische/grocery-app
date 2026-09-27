// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { App } from "./app";
import { useAuthStore } from "./stores/auth-store";
import { createApiFetchMock, json } from "./test/mock-api";
import "./test/setup";

const USER = { id: "u1", email: "alex@example.com", role: "admin" } as const;
const ACCESS_TOKEN_1 = "access-token-1";
const ACCESS_TOKEN_2 = "access-token-2";
const LISTS = [{ id: "l1", title: "Weekly", role: "OWNER", itemCounts: { toBuy: 5, bought: 2 } }];

function renderApp(initialPath: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function stubRoutes(mock: ReturnType<typeof createApiFetchMock>, options?: { refresh: number }) {
  mock.on("POST", "/api/auth/login", () => json(200, { accessToken: ACCESS_TOKEN_1, user: USER }));
  // Default: no refresh cookie (why the user is on the login page).
  mock.on("POST", "/api/auth/refresh", () =>
    options?.refresh === 200
      ? json(200, { accessToken: ACCESS_TOKEN_2, user: USER })
      : json(401, { error: { code: "UNAUTHORIZED", message: "Missing refresh token" } }),
  );
  mock.on("POST", "/api/auth/logout", () => json(204));
  mock.on("GET", "/api/lists", () => json(200, LISTS));
  mock.on("GET", "/api/lists/l1/items", () => json(200, { items: [] }));
}

describe("auth flow (docs/TASKS.md → T14 Definition of Done)", () => {
  it("login → lists load", async () => {
    const mock = createApiFetchMock();
    stubRoutes(mock); // refresh → 401: the user has no session yet
    mock.stub();
    const user = userEvent.setup();

    renderApp("/login");

    await user.type(await screen.findByLabelText("Email"), "alex@example.com");
    await user.type(screen.getByLabelText("Password"), "secret");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Weekly")).toBeInTheDocument();
    expect(screen.getByText("5 to buy · 2 bought")).toBeInTheDocument();

    // The account block lives in the overlay menu (T30).
    await user.click(screen.getByRole("button", { name: "Menu" }));
    expect(await screen.findByTestId("menu-user-email")).toHaveTextContent("alex@example.com");

    const loginCall = mock.callsTo("POST", "/api/auth/login")[0];
    expect(loginCall?.body).toEqual({ email: "alex@example.com", password: "secret" });
    const listsCall = mock.callsTo("GET", "/api/lists")[0];
    expect(listsCall?.headers.get("authorization")).toBe(`Bearer ${ACCESS_TOKEN_1}`);
    expect(useAuthStore.getState().accessToken).toBe(ACCESS_TOKEN_1);
  });

  it("page reload keeps the session (silent refresh on app open)", async () => {
    const mock = createApiFetchMock();
    stubRoutes(mock, { refresh: 200 });
    mock.stub();

    // "Reload": fresh app, empty in-memory store, but the refresh cookie exists.
    renderApp("/");

    expect(await screen.findByText("Weekly")).toBeInTheDocument();
    expect(mock.callsTo("POST", "/api/auth/refresh")).toHaveLength(1);
    expect(useAuthStore.getState().accessToken).toBe(ACCESS_TOKEN_2);
    const listsCall = mock.callsTo("GET", "/api/lists")[0];
    expect(listsCall?.headers.get("authorization")).toBe(`Bearer ${ACCESS_TOKEN_2}`);
  });

  it("expired session (refresh 401) → login page, no lists request", async () => {
    const mock = createApiFetchMock();
    stubRoutes(mock); // refresh → 401
    mock.stub();

    renderApp("/");

    expect(await screen.findByText("Sign in to your account")).toBeInTheDocument();
    expect(mock.callsTo("GET", "/api/lists")).toHaveLength(0);
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it("logout works: endpoint called, store cleared, back to the login page", async () => {
    const mock = createApiFetchMock();
    stubRoutes(mock, { refresh: 200 });
    mock.stub();
    const user = userEvent.setup();

    renderApp("/");
    // Sign out lives in the overlay menu (T30).
    await user.click(await screen.findByRole("button", { name: "Menu" }));
    await user.click(await screen.findByRole("button", { name: "Sign out" }));

    expect(await screen.findByText("Sign in to your account")).toBeInTheDocument();
    expect(mock.callsTo("POST", "/api/auth/logout")).toHaveLength(1);
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it("unknown routes redirect to the lists screen", async () => {
    const mock = createApiFetchMock();
    stubRoutes(mock, { refresh: 200 });
    mock.stub();

    renderApp("/nowhere");

    expect(await screen.findByText("Weekly")).toBeInTheDocument();
  });
});
