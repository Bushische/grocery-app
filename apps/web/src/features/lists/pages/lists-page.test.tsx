// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { createApiFetchMock, json } from "../../../test/mock-api";
import { ListsPage } from "./lists-page";
import "../../../test/setup";

const USER = { id: "u1", email: "alex@example.com", role: "admin" } as const;
const LISTS = [
  { id: "l1", title: "Weekly", role: "OWNER", itemCounts: { toBuy: 5, bought: 2 } },
  { id: "l2", title: "Party", role: "EDITOR", itemCounts: { toBuy: 1, bought: 0 } },
];

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

describe("ListsPage (T14 placeholder for the T15 lists view)", () => {
  it("renders the user's lists with item counts and the sign-out control", async () => {
    const mock = createApiFetchMock();
    mock.stub();
    mock.on("POST", "/api/auth/refresh", () => json(200, { accessToken: "token-1", user: USER }));
    mock.on("GET", "/api/lists", () => json(200, LISTS));

    renderPage();

    expect(await screen.findByText("Weekly")).toBeInTheDocument();
    expect(await screen.findByText("alex@example.com")).toBeInTheDocument();
    expect(screen.getByText("Party")).toBeInTheDocument();
    expect(screen.getByText("5 to buy · 2 bought")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("shows an error state when loading fails", async () => {
    const mock = createApiFetchMock();
    mock.stub();
    mock.on("POST", "/api/auth/refresh", () => json(200, { accessToken: "token-1", user: USER }));
    mock.on("GET", "/api/lists", () =>
      json(500, { error: { code: "INTERNAL_ERROR", message: "boom" } }),
    );

    renderPage();

    expect(await screen.findByText("Could not load your lists.")).toBeInTheDocument();
  });
});
