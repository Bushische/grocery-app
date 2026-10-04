// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "../../../test/setup";
import { BuyHistory } from "./buy-history";

describe("BuyHistory (T80: last-5 bought dates)", () => {
  it("renders the dates newest-first", () => {
    render(
      <BuyHistory
        dates={["2026-09-25T10:00:00.000Z", "2026-09-20T10:00:00.000Z", "2026-09-10T10:00:00.000Z"]}
      />,
    );
    const rows = screen.getAllByTestId("buy-history-date");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("25 Sep 2026");
    expect(rows[1]).toHaveTextContent("20 Sep 2026");
    expect(rows[2]).toHaveTextContent("10 Sep 2026");
  });

  it("renders nothing when the item was never bought", () => {
    const { container } = render(<BuyHistory dates={[]} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId("buy-history-date")).not.toBeInTheDocument();
  });
});
