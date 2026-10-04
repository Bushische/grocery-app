import { describe, expect, it } from "vitest";
import { SWIPE_REVEAL_THRESHOLD, swipeRevealForDelta } from "./swipe-action";

describe("swipeRevealForDelta (T76 swipe-to-action mapping, pure)", () => {
  it("reveals Edit on a left swipe past the threshold", () => {
    expect(swipeRevealForDelta(-50, 0)).toBe("edit");
    expect(swipeRevealForDelta(-SWIPE_REVEAL_THRESHOLD, 5)).toBe("edit");
  });

  it("reveals Delete on a right swipe past the threshold", () => {
    expect(swipeRevealForDelta(50, 0)).toBe("delete");
    expect(swipeRevealForDelta(SWIPE_REVEAL_THRESHOLD, -5)).toBe("delete");
  });

  it("reveals nothing below the threshold", () => {
    expect(swipeRevealForDelta(0, 0)).toBeNull();
    expect(swipeRevealForDelta(39, 0)).toBeNull();
    expect(swipeRevealForDelta(-39, 0)).toBeNull();
  });

  it("never reveals on vertical scroll (vertical dominates)", () => {
    expect(swipeRevealForDelta(0, 80)).toBeNull();
    expect(swipeRevealForDelta(10, 60)).toBeNull();
    expect(swipeRevealForDelta(-60, 80)).toBeNull();
  });

  it("prefers horizontal only when it dominates a diagonal", () => {
    expect(swipeRevealForDelta(-60, 20)).toBe("edit");
    expect(swipeRevealForDelta(60, 20)).toBe("delete");
  });
});
