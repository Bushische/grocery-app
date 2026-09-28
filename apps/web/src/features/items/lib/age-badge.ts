import type { Item } from "@grocery/shared";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * T42: humanized age badge — derives the label from `item.addedAt` client-side
 * ("< 60 min" → `5m`, "< 24 h" → `19h`, "≥ 24 h" → `3d`), replacing the server
 * `daysInList`-based badge that read "0d" for everything younger than a day.
 * Whole-day rounding matches the server's `floor(now − addedAt)` days.
 */
export function formatAgeBadge(item: Pick<Item, "addedAt">, now: Date = new Date()): string {
  const elapsed = Math.max(0, now.getTime() - new Date(item.addedAt).getTime());
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}m`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}h`;
  return `${Math.floor(elapsed / DAY_MS)}d`;
}
