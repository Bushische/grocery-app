import type { Item } from "@grocery/shared";
import { describe, expect, it } from "vitest";
import { formatAgeBadge } from "./age-badge";

/** T42: three age buckets — < 60 min → `5m`, < 24 h → `19h`, ≥ 24 h → `3d`. */
describe("formatAgeBadge", () => {
  const NOW = new Date("2026-09-28T12:00:00.000Z");

  function itemWithAge(msAgo: number): Pick<Item, "addedAt"> {
    return { addedAt: new Date(NOW.getTime() - msAgo).toISOString() };
  }

  it("shows minutes for ages under an hour", () => {
    expect(formatAgeBadge(itemWithAge(5 * 60_000), NOW)).toBe("5m");
    expect(formatAgeBadge(itemWithAge(0), NOW)).toBe("0m");
    expect(formatAgeBadge(itemWithAge(59 * 60_000), NOW)).toBe("59m");
  });

  it("shows hours for ages under a day (1-hour-old item is '1h', not '0d')", () => {
    expect(formatAgeBadge(itemWithAge(60 * 60_000), NOW)).toBe("1h");
    expect(formatAgeBadge(itemWithAge(19 * 60 * 60_000), NOW)).toBe("19h");
    expect(formatAgeBadge(itemWithAge(23 * 60 * 60_000 + 59 * 60_000), NOW)).toBe("23h");
  });

  it("shows whole days (floor, same rounding as the server) for ages ≥ 24 h", () => {
    expect(formatAgeBadge(itemWithAge(24 * 60 * 60_000), NOW)).toBe("1d");
    expect(formatAgeBadge(itemWithAge(3 * 24 * 60 * 60_000), NOW)).toBe("3d");
    expect(formatAgeBadge(itemWithAge(3 * 24 * 60 * 60_000 + 23 * 60 * 60_000), NOW)).toBe("3d");
  });

  it("never goes negative for a future addedAt (clock skew)", () => {
    expect(formatAgeBadge(itemWithAge(-5 * 60_000), NOW)).toBe("0m");
  });
});
