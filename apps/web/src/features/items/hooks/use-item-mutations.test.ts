import type { Item } from "@grocery/shared";
import { describe, expect, it } from "vitest";
import { applyMove } from "./use-item-mutations";

/** T48: buying prepends to the top of BOUGHT; un-buying appends to TO_BUY. */
describe("applyMove", () => {
  function item(id: string, status: "TO_BUY" | "BOUGHT", categoryId = "c1", sortOrder = 0): Item {
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
    } as Item;
  }

  it("prepends a bought item to the top of the BOUGHT section", () => {
    const data = { items: [item("a", "TO_BUY"), item("b", "TO_BUY"), item("old", "BOUGHT")] };
    const afterBuyA = applyMove(data, "a", "BOUGHT");
    expect(afterBuyA.items.map((i) => i.id)).toEqual(["b", "a", "old"]);

    const afterBuyB = applyMove({ items: afterBuyA.items }, "b", "BOUGHT");
    expect(afterBuyB.items.map((i) => i.id)).toEqual(["b", "a", "old"]);
  });

  it("appends an un-bought item to the end of TO_BUY", () => {
    const data = {
      items: [item("milk", "TO_BUY"), item("bread", "TO_BUY"), item("butter", "BOUGHT")],
    };
    const next = applyMove(data, "butter", "TO_BUY");
    expect(next.items.map((i) => i.id)).toEqual(["milk", "bread", "butter"]);
  });

  it("re-buying an already-BOUGHT item moves it to the top", () => {
    const data = { items: [item("x", "TO_BUY"), item("a", "BOUGHT"), item("b", "BOUGHT")] };
    const next = applyMove(data, "b", "BOUGHT");
    expect(next.items.map((i) => i.id)).toEqual(["x", "b", "a"]);
  });

  it("T75 rule 3 (optimistic): buying lands at the top of its category run, shifting followers", () => {
    const data = {
      items: [
        item("d1", "BOUGHT", "dairy", 0),
        item("o1", "BOUGHT", "other", 1),
        item("new", "TO_BUY", "dairy", 0),
      ],
    };
    const next = applyMove(data, "new", "BOUGHT");
    expect(next.items.map((i) => i.id)).toEqual(["new", "d1", "o1"]);
    expect(next.items.map((i) => i.sortOrder)).toEqual([0, 1, 2]);
  });

  it("T75 rule 3 (optimistic): un-buying lands at the end of its category run, shifting followers", () => {
    const data = {
      items: [
        item("d1", "TO_BUY", "dairy", 0),
        item("o1", "TO_BUY", "other", 1),
        item("back", "BOUGHT", "dairy", 0),
      ],
    };
    const next = applyMove(data, "back", "TO_BUY");
    expect(next.items.map((i) => i.id)).toEqual(["d1", "back", "o1"]);
    expect(next.items.map((i) => i.sortOrder)).toEqual([0, 1, 2]);
  });
});
