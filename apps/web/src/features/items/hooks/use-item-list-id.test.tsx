import type { Item } from "@grocery/shared";
// @vitest-environment jsdom
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { findItemListIdInCache } from "./use-item-list-id";
import "../../../test/setup";

const CATEGORY = { id: "c1", title: "Other", color: "#6B7280" } as const;

function item(id: string): Item {
  return {
    id,
    title: "Milk",
    qtyText: null,
    status: "TO_BUY",
    sortOrder: 0,
    addedAt: "2026-09-24T08:00:00.000Z",
    daysInList: 3,
    category: CATEGORY,
    imageFilename: null,
    currentPrice: null,
  };
}

describe("findItemListIdInCache (docs/TASKS.md → T41, pure)", () => {
  it("resolves the list id from a cached ['items', listId] query", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["items", "l1"], { items: [item("i1")] });

    expect(findItemListIdInCache(queryClient, "i1")).toBe("l1");
  });

  it("skips category-view caches (their second key part is not a list id)", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["items", "category", "c9"], { items: [item("i1")] });

    expect(findItemListIdInCache(queryClient, "i1")).toBeNull();
  });

  it("returns null when no cached query holds the item", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["items", "l1"], { items: [item("i2")] });

    expect(findItemListIdInCache(queryClient, "i1")).toBeNull();
    expect(findItemListIdInCache(new QueryClient(), "i1")).toBeNull();
  });
});
