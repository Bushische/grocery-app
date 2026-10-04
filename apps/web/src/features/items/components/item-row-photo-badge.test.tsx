// @vitest-environment jsdom
import type { Item } from "@grocery/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { useAuthStore } from "../../../stores/auth-store";
import { createApiFetchMock } from "../../../test/mock-api";
import "../../../test/setup";
import { ItemSectionsContainer } from "./item-sections-container";

const CATEGORY = { id: "c1", title: "Other", color: "#6B7280" } as const;
const ADDED_AT = "2026-09-24T08:00:00.000Z";

function item(
  id: string,
  title: string,
  status: "TO_BUY" | "BOUGHT",
  imageFilename: string | null,
): Item {
  return {
    id,
    title,
    qtyText: null,
    status,
    sortOrder: 0,
    addedAt: ADDED_AT,
    daysInList: 3,
    category: CATEGORY,
    imageFilename,
    currentPrice: null,
  };
}

function renderRows(toBuy: Item[], bought: Item[]): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route
            path="/"
            element={<ItemSectionsContainer listId="l1" toBuy={toBuy} bought={bought} />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ItemRow photo badge (T77)", () => {
  afterEach(() => {
    useAuthStore.setState({ accessToken: null, user: null });
  });

  it("shows the photo badge next to the age badge when imageFilename is non-null (TO_BUY)", () => {
    useAuthStore.setState({ accessToken: "t", user: { id: "u1", email: "a@b.co", role: "user" } });
    createApiFetchMock().stub();
    renderRows([item("i1", "Milk", "TO_BUY", "i1-abc.webp")], []);

    const badge = screen.getByTestId("photo-badge-i1");
    expect(badge).toHaveTextContent("📸");
    expect(badge).toHaveAttribute("aria-hidden", "true");

    // Positioned by the age badge: immediate sibling before it.
    const age = screen.getByLabelText(/Milk: added \d+d ago/);
    expect(badge.nextElementSibling).toBe(age);

    // Decorative: the row label is unchanged.
    expect(screen.getByTestId("row-body-i1")).toHaveAttribute("aria-label", "Mark Milk as bought");
  });

  it("shows the photo badge muted in BOUGHT rows", () => {
    useAuthStore.setState({ accessToken: "t", user: { id: "u1", email: "a@b.co", role: "user" } });
    createApiFetchMock().stub();
    renderRows([], [item("i3", "Butter", "BOUGHT", "i3-abc.webp")]);

    const badge = screen.getByTestId("photo-badge-i3");
    expect(badge).toHaveTextContent("📸");
    expect(badge).toHaveAttribute("aria-hidden", "true");
    expect(badge.className).toMatch(/opacity-60/);

    const age = screen.getByLabelText(/Butter: added \d+d ago/);
    expect(badge.nextElementSibling).toBe(age);
    expect(screen.getByTestId("row-body-i3")).toHaveAttribute(
      "aria-label",
      "Move Butter back to to buy",
    );
  });

  it("omits the photo badge when imageFilename is null", () => {
    useAuthStore.setState({ accessToken: "t", user: { id: "u1", email: "a@b.co", role: "user" } });
    createApiFetchMock().stub();
    renderRows([item("i1", "Milk", "TO_BUY", null)], [item("i3", "Butter", "BOUGHT", null)]);

    expect(screen.queryByTestId("photo-badge-i1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("photo-badge-i3")).not.toBeInTheDocument();
    // Age badges still render on their own.
    expect(screen.getByLabelText(/Milk: added \d+d ago/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Butter: added \d+d ago/)).toBeInTheDocument();
  });
});
