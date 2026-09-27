import type { PriceObservation } from "@grocery/shared";
import { useEffect, useMemo, useRef } from "react";
import type uPlot from "uplot";

const CHART_HEIGHT = 200;
const FALLBACK_WIDTH = 320;
const UTC_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export interface PriceChartData {
  /** Unix seconds on the X axis, oldest → newest. */
  xs: number[];
  /** Prices aligned with `xs`. */
  ys: number[];
  /** Observations in chart order (oldest first). */
  points: PriceObservation[];
}

/**
 * Maps the API's price history (newest first, docs/API.md → Prices) onto
 * uplot's aligned data: X runs left→right in time.
 */
export function buildPriceChartData(observations: PriceObservation[]): PriceChartData {
  const points = [...observations].reverse();
  return {
    xs: points.map((observation) => Math.round(new Date(observation.observedAt).getTime() / 1000)),
    ys: points.map((observation) => observation.price),
    points,
  };
}

/** "25 Sep 2026" — UTC, deterministic across devices/timezones. */
export function formatObservationDate(observedAt: string): string {
  const date = new Date(observedAt);
  return `${date.getUTCDate()} ${UTC_MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/**
 * Price history line chart (docs/TASKS.md → T18): uplot draws the line and
 * points on a canvas; the legend under it is each point's label — price + shop
 * + date (docs/PROJECT.md → Item Detail View).
 */
export function PriceChart({ observations }: { observations: PriceObservation[] }) {
  const { xs, ys, points } = useMemo(() => buildPriceChartData(observations), [observations]);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const options: uPlot.Options = {
      width: container.clientWidth || FALLBACK_WIDTH,
      height: CHART_HEIGHT,
      series: [
        {},
        {
          label: "Price",
          stroke: "#16a34a",
          width: 2,
          points: { show: true, size: 5 },
        },
      ],
      scales: { x: { time: true } },
      axes: [
        { label: "Date" },
        {
          label: "Price",
          values: (_uplot, ticks) => ticks.map((tick) => tick.toFixed(2)),
        },
      ],
    };
    let disposed = false;
    let chart: { destroy(): void } | null = null;
    // Dynamic import: uplot runs `matchMedia` at module load, which jsdom
    // (and any non-browser importer of this module) does not provide.
    void import("uplot").then(({ default: UPlot }) => {
      if (disposed) return;
      chart = new UPlot(options, [xs, ys] as uPlot.AlignedData, container);
    });
    return () => {
      disposed = true;
      chart?.destroy();
    };
  }, [xs, ys]);

  return (
    <div>
      <div ref={containerRef} data-testid="price-chart" />
      <ul aria-label="Price points" className="mt-2 space-y-1">
        {points.map((point) => (
          <li
            key={`${point.observedAt}-${point.shop}-${point.price}`}
            data-testid="price-point"
            className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-gray-200"
          >
            <span className="font-semibold text-gray-900">{point.price.toFixed(2)}</span>
            <span className="min-w-0 flex-1 truncate text-gray-700">{point.shop}</span>
            <time dateTime={point.observedAt} className="shrink-0 text-gray-500">
              {formatObservationDate(point.observedAt)}
            </time>
          </li>
        ))}
      </ul>
    </div>
  );
}
