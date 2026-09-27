// @vitest-environment jsdom
import type { PriceObservation } from "@grocery/shared";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../../../test/setup";
import { PriceChart } from "./price-chart";

const { uPlotCtor } = vi.hoisted(() => ({
  uPlotCtor: vi.fn((_opts: unknown, _data: unknown, _target: unknown) => ({
    destroy: vi.fn(),
  })),
}));
// jsdom cannot rasterize — the chart's layout/options contract is asserted via this mock.
vi.mock("uplot", () => ({ default: uPlotCtor }));

function observation(observedAt: string, price: number, shop = "Lidl"): PriceObservation {
  return { price, shop, observedAt };
}
const OLD = "2026-09-20T10:00:00.000Z";
const NEW = "2026-09-25T10:00:00.000Z";

beforeEach(() => {
  uPlotCtor.mockClear();
});

describe("PriceChart (T28: reserved layout space + placeholders)", () => {
  it("shows a placeholder instead of a chart for an empty history", () => {
    render(<PriceChart observations={[]} />);
    expect(screen.getByTestId("price-chart-placeholder")).toHaveTextContent(
      "No prices recorded yet.",
    );
    expect(screen.queryByTestId("price-chart")).not.toBeInTheDocument();
    expect(uPlotCtor).not.toHaveBeenCalled();
  });

  it("single point: readable placeholder instead of a degenerate chart", () => {
    render(<PriceChart observations={[observation(NEW, 1.99, "Lidl")]} />);
    expect(screen.getByTestId("price-chart-placeholder")).toBeInTheDocument();
    expect(screen.getByTestId("price-chart-placeholder")).toHaveTextContent(
      "Add more prices to see the price history chart.",
    );
    const point = screen.getByTestId("price-point");
    expect(point).toHaveTextContent("1.99");
    expect(point).toHaveTextContent("Lidl");
    expect(point).toHaveTextContent("25 Sep 2026");
    expect(screen.queryByTestId("price-chart")).not.toBeInTheDocument();
    expect(uPlotCtor).not.toHaveBeenCalled();
  });

  it("two points: uplot renders into a reserved, relatively positioned, clipped box", async () => {
    render(<PriceChart observations={[observation(NEW, 1.99), observation(OLD, 2.49, "Netto")]} />);

    const wrapper = screen.getByTestId("price-chart");
    expect(wrapper).toHaveStyle({ height: "200px" });
    expect(wrapper.className).toContain("relative");
    expect(wrapper.className).toContain("w-full");
    expect(wrapper.className).toContain("overflow-hidden");

    await waitFor(() => expect(uPlotCtor).toHaveBeenCalledTimes(1));
    const [opts, data, target] = uPlotCtor.mock.calls[0] as [
      Record<string, unknown>,
      number[][],
      HTMLElement,
    ];
    expect(target).toBe(wrapper);
    // jsdom has no layout → the fallback width; height always reserved.
    expect(opts.width).toBe(320);
    expect(opts.height).toBe(200);
    // uplot's built-in legend is off — the custom rows below are the labels.
    expect((opts.legend as { show: boolean }).show).toBe(false);
    // y-axis padding: 15% of the span with a floor, so edge points/ticks
    // never clip (span 0.5 → the 0.25 floor applies here).
    const range = (
      opts.scales as { y: { range: (u: unknown, min: number, max: number) => [number, number] } }
    ).y.range;
    const [yMin, yMax] = range(null, 1.99, 2.49);
    expect(yMin).toBeCloseTo(1.74, 10);
    expect(yMax).toBeCloseTo(2.74, 10);
    // oldest → newest on the X axis
    expect(data[1]).toEqual([2.49, 1.99]);
  });

  it("labels every point below the chart (price + shop + date)", async () => {
    render(<PriceChart observations={[observation(NEW, 1.99), observation(OLD, 2.49, "Netto")]} />);
    await waitFor(() => expect(uPlotCtor).toHaveBeenCalledTimes(1));
    const rows = screen.getAllByTestId("price-point");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("2.49");
    expect(rows[0]).toHaveTextContent("Netto");
    expect(rows[0]).toHaveTextContent("20 Sep 2026");
    expect(rows[1]).toHaveTextContent("1.99");
    expect(rows[1]).toHaveTextContent("Lidl");
    expect(rows[1]).toHaveTextContent("25 Sep 2026");
  });
});
