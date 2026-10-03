import type { Item } from "@grocery/shared";
import { describe, expect, it } from "vitest";
import { removeItemFromCache } from "./use-item-detail-mutations";

const ADDED_AT = "2026-09-24T08:00:00.000Z";

function item(id: string, status: Item["status"] = "TO_BUY"): Item {
  return {
    id,
    title: `Item ${id}`,
    qtyText: null,
    status,
    sortOrder: 0,
    addedAt: ADDED_AT,
    daysInList: 3,
    category: { id: "c1", title: "Other", color: "#6B7280" },
    imageFilename: null,
    currentPrice: null,
  };
}

describe("removeItemFromCache (pure)", () => {
  it("drops only the matching row, keeping section order", () => {
    const data = { items: [item("i1"), item("i2"), item("i3", "BOUGHT")] };
    expect(removeItemFromCache(data, "i2")).toEqual({
      items: [data.items[0], data.items[2]],
    });
  });

  it("is a no-op for an unknown id", () => {
    const data = { items: [item("i1")] };
    expect(removeItemFromCache(data, "zzz")).toEqual(data);
  });
});
