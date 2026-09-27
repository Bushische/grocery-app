import type { PriceObservation } from "@grocery/shared";
import { describe, expect, it } from "vitest";
import { buildPriceChartData, formatObservationDate, priceYRange } from "./price-chart";

function observation(observedAt: string, price: number, shop = "Lidl"): PriceObservation {
  return { price, shop, observedAt };
}

describe("buildPriceChartData (T18 price history → uplot aligned data)", () => {
  it("flips the API's newest-first history into a time-ascending X axis", () => {
    const data = buildPriceChartData([
      observation("2026-09-25T10:00:00.000Z", 1.99),
      observation("2026-09-20T10:00:00.000Z", 2.49),
      observation("2026-09-10T10:00:00.000Z", 2.19),
    ]);

    expect(data.xs).toEqual([
      Math.round(new Date("2026-09-10T10:00:00.000Z").getTime() / 1000),
      Math.round(new Date("2026-09-20T10:00:00.000Z").getTime() / 1000),
      Math.round(new Date("2026-09-25T10:00:00.000Z").getTime() / 1000),
    ]);
    expect(data.ys).toEqual([2.19, 2.49, 1.99]);
    expect(data.points.map((point) => point.price)).toEqual([2.19, 2.49, 1.99]);
  });

  it("keeps a single point and handles an empty history", () => {
    const single = buildPriceChartData([observation("2026-09-25T10:00:00.000Z", 3.1, "Netto")]);
    expect(single.ys).toEqual([3.1]);
    expect(single.points[0]?.shop).toBe("Netto");

    const empty = buildPriceChartData([]);
    expect(empty.xs).toEqual([]);
    expect(empty.ys).toEqual([]);
  });

  it("formats point labels as UTC dates", () => {
    expect(formatObservationDate("2026-09-25T10:00:00.000Z")).toBe("25 Sep 2026");
  });
});

describe("priceYRange (T28 y-axis padding)", () => {
  it("pads a wide price span by 15% on each side", () => {
    const [min, max] = priceYRange(0.79, 3.99);
    expect(min).toBeCloseTo(0.31, 10);
    expect(max).toBeCloseTo(4.47, 10);
  });

  it("floors the padding so flat/narrow histories keep readable tick labels", () => {
    const [flatMin, flatMax] = priceYRange(1.99, 1.99);
    expect(flatMin).toBeCloseTo(1.74, 10);
    expect(flatMax).toBeCloseTo(2.24, 10);

    const [narrowMin, narrowMax] = priceYRange(1.99, 2.49);
    expect(narrowMin).toBeCloseTo(1.74, 10);
    expect(narrowMax).toBeCloseTo(2.74, 10);
  });

  it("keeps the data inside the range", () => {
    const [min, max] = priceYRange(0.79, 3.99);
    expect(min).toBeLessThan(0.79);
    expect(max).toBeGreaterThan(3.99);
  });

  it("falls back to a unit range for degenerate input", () => {
    expect(priceYRange(Number.NaN, 2.49)).toEqual([0, 1]);
    expect(priceYRange(3, Number.NaN)).toEqual([0, 1]);
    expect(priceYRange(2.49, 1.99)).toEqual([0, 1]);
  });
});
