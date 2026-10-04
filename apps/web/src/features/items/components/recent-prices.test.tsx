// @vitest-environment jsdom
import type { PriceObservation } from "@grocery/shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "../../../test/setup";
import { RecentPrices } from "./recent-prices";

function observation(observedAt: string, price: number, shop = "Lidl"): PriceObservation {
  return { price, shop, observedAt };
}

const DATES = [
  "2026-09-25T10:00:00.000Z",
  "2026-09-24T10:00:00.000Z",
  "2026-09-23T10:00:00.000Z",
  "2026-09-22T10:00:00.000Z",
  "2026-09-21T10:00:00.000Z",
  "2026-09-20T10:00:00.000Z",
  "2026-09-19T10:00:00.000Z",
];

describe("RecentPrices (T80: 5 newest observations as rows)", () => {
  it("renders the 5 newest rows newest-first with price, shop, and date", () => {
    render(
      <RecentPrices
        observations={DATES.map((date, index) =>
          observation(date, 1 + index / 100, `Shop${index}`),
        )}
      />,
    );
    const rows = screen.getAllByTestId("recent-price");
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent("1.00");
    expect(rows[0]).toHaveTextContent("Shop0");
    expect(rows[0]).toHaveTextContent("25 Sep 2026");
    expect(rows[4]).toHaveTextContent("Shop4");
    expect(rows[4]).toHaveTextContent("21 Sep 2026");
    // The 6th/7th (older) observations are capped out of the render.
    expect(screen.queryByText("Shop5")).not.toBeInTheDocument();
    expect(screen.queryByText("Shop6")).not.toBeInTheDocument();
  });

  it('renders an unknown shop ("") as price + date only', () => {
    render(<RecentPrices observations={[observation(DATES[0]!, 1.99, "")]} />);
    const row = screen.getByTestId("recent-price");
    expect(row).toHaveTextContent("1.99");
    expect(row).toHaveTextContent("25 Sep 2026");
    expect(row.textContent).toBe("1.9925 Sep 2026");
  });

  it("shows an empty state when no prices exist", () => {
    render(<RecentPrices observations={[]} />);
    expect(screen.getByTestId("recent-prices-empty")).toHaveTextContent("No prices recorded yet.");
    expect(screen.queryByTestId("recent-price")).not.toBeInTheDocument();
  });
});
