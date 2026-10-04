import type { Item } from "@grocery/shared";
import { describe, expect, it } from "vitest";
import { groupAwareReorderedIds, groupSectionItems } from "./grouping";

function item(
  id: string,
  categoryId: string,
  sortOrder: number,
  status: Item["status"] = "TO_BUY",
): Item {
  return {
    id,
    title: id,
    qtyText: null,
    status,
    sortOrder,
    addedAt: new Date("2026-09-28T12:00:00.000Z").toISOString(),
    daysInList: 0,
    category: { id: categoryId, title: categoryId, color: "#6B7280" },
    imageFilename: null,
    currentPrice: null,
  };
}

describe("groupSectionItems (T75 grouped rendering)", () => {
  it("orders groups by first-item position and items by sortOrder, coalescing runs", () => {
    const items = [item("b1", "b", 3), item("a1", "a", 0), item("b2", "b", 1), item("a2", "a", 2)];
    const groups = groupSectionItems(items);
    expect(groups.map((group) => group.category.id)).toEqual(["a", "b"]);
    expect(groups[0]!.items.map((entry) => entry.id)).toEqual(["a1", "a2"]);
    expect(groups[1]!.items.map((entry) => entry.id)).toEqual(["b2", "b1"]);
  });
});

describe("groupAwareReorderedIds rule 1 (within-group, both sections)", () => {
  it("reorders inside the group run, leaving other groups untouched (TO_BUY)", () => {
    const section = [item("a1", "a", 0), item("a2", "a", 1), item("b1", "b", 2)];
    expect(groupAwareReorderedIds(section, "a1", "a2")).toEqual(["a2", "a1", "b1"]);
  });

  it("reorders inside the group run (BOUGHT section too)", () => {
    const section = [
      item("x1", "x", 0, "BOUGHT"),
      item("x2", "x", 1, "BOUGHT"),
      item("y1", "y", 2, "BOUGHT"),
    ];
    expect(groupAwareReorderedIds(section, "x2", "x1")).toEqual(["x2", "x1", "y1"]);
  });
});

describe("groupAwareReorderedIds rule 2 (cross-group block move)", () => {
  it("moves the dragged item to the top of its group and its block above the target group", () => {
    const section = [
      item("a1", "a", 0),
      item("a2", "a", 1),
      item("a3", "a", 2),
      item("a4", "a", 3),
      item("b1", "b", 4),
      item("b2", "b", 5),
      item("b3", "b", 6),
    ];
    expect(groupAwareReorderedIds(section, "b2", "a2")).toEqual([
      "b2",
      "b1",
      "b3",
      "a1",
      "a2",
      "a3",
      "a4",
    ]);
  });

  it("is a no-op when the block is already above the target with the item on top", () => {
    const section = [item("b2", "b", 0), item("b1", "b", 1), item("a1", "a", 2)];
    expect(groupAwareReorderedIds(section, "b2", "a1")).toBeNull();
  });

  it("returns null for same-item and unknown ids", () => {
    const section = [item("a1", "a", 0), item("b1", "b", 1)];
    expect(groupAwareReorderedIds(section, "a1", "a1")).toBeNull();
    expect(groupAwareReorderedIds(section, "a1", "zzz")).toBeNull();
    expect(groupAwareReorderedIds(section, "zzz", "b1")).toBeNull();
  });
});
