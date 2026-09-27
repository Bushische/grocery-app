import type { PriceObservation } from "@grocery/shared";
import { describe, expect, it } from "vitest";
import { buildPriceChartData, formatObservationDate } from "./price-chart";

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
