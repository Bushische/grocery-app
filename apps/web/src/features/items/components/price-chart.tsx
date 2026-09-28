// uPlot's CSS anchors its canvases inside .u-wrap (position: relative);
// without it the canvases anchor to the page and overlap surrounding content.
import "uplot/dist/uPlot.min.css";
import type { PriceObservation } from "@grocery/shared";
import { useEffect, useMemo, useRef } from "react";
import type uPlot from "uplot";

const CHART_HEIGHT = 200;
const FALLBACK_WIDTH = 320;
/** Y-axis padding: 15% of the price span on each side… */
const Y_PAD_RATIO = 0.15;
/** …floored so flat histories (equal prices) still get readable tick labels. */
const Y_PAD_MIN_SPAN = 0.25;

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

/**
 * Re-ranges the y scale so the outermost points never sit on the chart edges
 * and tick labels (`.toFixed(2)`) stay readable.
 */
export function priceYRange(dataMin: number, dataMax: number): [number, number] {
  if (!Number.isFinite(dataMin) || !Number.isFinite(dataMax) || dataMin > dataMax) {
    return [0, 1];
  }
  const pad = Math.max((dataMax - dataMin) * Y_PAD_RATIO, Y_PAD_MIN_SPAN);
  return [dataMin - pad, dataMax + pad];
}

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

function PricePointRow({ point }: { point: PriceObservation }) {
  return (
    <li
      data-testid="price-point"
      className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-gray-200"
    >
      <span className="font-semibold text-gray-900">{point.price.toFixed(2)}</span>
      {/* T44: shop "" means unknown — render the price only, no dangling label. */}
      {point.shop !== "" ? (
        <span className="min-w-0 flex-1 truncate text-gray-700">{point.shop}</span>
      ) : null}
      <time dateTime={point.observedAt} className="shrink-0 text-gray-500">
        {formatObservationDate(point.observedAt)}
      </time>
    </li>
  );
}

/**
 * Price history line chart (docs/TASKS.md → T18, layout fixed in T28): uplot
 * draws the line and points on a canvas; the legend under it is each point's
 * label — price + shop + date (docs/PROJECT.md → Item Detail View).
 *
 * Layout contract: the chart lives in its own reserved block — a relatively
 * positioned, fixed-height, full-width wrapper — so its absolutely positioned
 * canvases can never overlap the price form above or anything below it.
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
      // The custom legend rows below are the per-point labels (price + shop +
      // date); uplot's built-in table would only duplicate them.
      legend: { show: false },
      series: [
        {},
        {
          label: "Price",
          stroke: "#16a34a",
          width: 2,
          points: { show: true, size: 5 },
        },
      ],
      scales: {
        x: { time: true },
        y: { range: (_u, dataMin, dataMax) => priceYRange(dataMin, dataMax) },
      },
      axes: [
        { label: "Date" },
        {
          label: "Price",
          values: (_uplot, ticks) => ticks.map((tick) => tick.toFixed(2)),
        },
      ],
    };
    let disposed = false;
    let chart: uPlot | null = null;
    let observer: ResizeObserver | null = null;
    // Dynamic import: uplot runs `matchMedia` at module load, which jsdom
    // (and any non-browser importer of this module) does not provide.
    void import("uplot").then(({ default: UPlot }) => {
      if (disposed) return;
      chart = new UPlot(options, [xs, ys] as uPlot.AlignedData, container);
      // Responsive width: uplot is sized in px at construction, so re-size it
      // when the wrapper's width changes (rotation, breakpoint, resize).
      if (typeof ResizeObserver === "function") {
        observer = new ResizeObserver((entries) => {
          const width = Math.round(entries.at(-1)?.contentRect.width ?? container.clientWidth);
          if (width > 0 && chart && Math.abs(width - chart.width) >= 1) {
            chart.setSize({ width, height: CHART_HEIGHT });
          }
        });
        observer.observe(container);
      }
    });
    return () => {
      disposed = true;
      observer?.disconnect();
      observer = null;
      chart?.destroy();
      chart = null;
    };
  }, [xs, ys]);

  if (points.length === 0) {
    return (
      <div data-testid="price-chart-placeholder">
        <p className="text-sm text-gray-500">No prices recorded yet.</p>
      </div>
    );
  }

  // A single point degenerates into a zero-span x scale — show its label
  // cleanly instead of a broken chart.
  if (points.length === 1) {
    return (
      <div data-testid="price-chart-placeholder">
        <ul aria-label="Price points" className="space-y-1">
          <PricePointRow point={points[0] as PriceObservation} />
        </ul>
        <p className="mt-2 text-sm text-gray-500">
          Add more prices to see the price history chart.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div
        ref={containerRef}
        data-testid="price-chart"
        className="relative w-full overflow-hidden"
        style={{ height: CHART_HEIGHT }}
      />
      <ul aria-label="Price points" className="mt-2 space-y-1">
        {points.map((point) => (
          <PricePointRow key={`${point.observedAt}-${point.shop}-${point.price}`} point={point} />
        ))}
      </ul>
    </div>
  );
}
