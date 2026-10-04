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

/** "25 Sep 2026" — UTC, deterministic across devices/timezones. */
export function formatBoughtDate(isoDateTime: string): string {
  const date = new Date(isoDateTime);
  return `${date.getUTCDate()} ${UTC_MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/**
 * Compact list of the item's last-bought dates (T80, up to 5, newest first
 * from `GET /items/:id` → `buyHistory`). Renders nothing when the item was
 * never bought — the details page hides the whole section then.
 */
export function BuyHistory({ dates }: { dates: string[] }) {
  if (dates.length === 0) {
    return null;
  }
  return (
    <ul aria-label="Bought dates" className="space-y-1">
      {dates.map((date) => (
        <li
          key={date}
          data-testid="buy-history-date"
          className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-gray-200"
        >
          <time dateTime={date} className="text-gray-700">
            {formatBoughtDate(date)}
          </time>
        </li>
      ))}
    </ul>
  );
}
