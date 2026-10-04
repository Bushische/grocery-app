import type { PriceObservation } from "@grocery/shared";
import { formatBoughtDate } from "./buy-history";

/** How many of the newest observations the details card shows (T80). */
export const MAX_RECENT_PRICES = 5;

/**
 * The 5 newest price observations as compact rows (T80, newest first from
 * `GET /items/:id` → `prices`). The full history stays loaded in the query
 * cache for future analysis — only the rendering is capped.
 */
export function RecentPrices({ observations }: { observations: PriceObservation[] }) {
  const recent = observations.slice(0, MAX_RECENT_PRICES);
  if (recent.length === 0) {
    return (
      <div data-testid="recent-prices-empty">
        <p className="text-sm text-gray-500">No prices recorded yet.</p>
      </div>
    );
  }
  return (
    <ul aria-label="Recent prices" className="space-y-1">
      {recent.map((point) => (
        <li
          key={`${point.observedAt}-${point.shop}-${point.price}`}
          data-testid="recent-price"
          className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-gray-200"
        >
          <span className="font-semibold text-gray-900">{point.price.toFixed(2)}</span>
          {point.shop !== "" ? (
            <span className="min-w-0 flex-1 truncate text-gray-700">{point.shop}</span>
          ) : null}
          <time dateTime={point.observedAt} className="shrink-0 text-gray-500">
            {formatBoughtDate(point.observedAt)}
          </time>
        </li>
      ))}
    </ul>
  );
}
