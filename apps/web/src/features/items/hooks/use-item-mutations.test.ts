import type { Item } from "@grocery/shared";
import { describe, expect, it } from "vitest";
import { applyMove } from "./use-item-mutations";

/** T48: buying prepends to the top of BOUGHT; un-buying appends to TO_BUY. */
describe("applyMove", () => {
  function item(id: string, status: "TO_BUY" | "BOUGHT"): Item {
    return {
      id,
      title: id,
      qtyText: null,
      status,
      sortOrder: 0,
      addedAt: new Date("2026-09-28T12:00:00.000Z").toISOString(),
      daysInList: 0,
      category: { id: "c1", title: "Other", color: "#6B7280" },
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
});
