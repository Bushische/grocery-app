import { describe, expect, it } from "vitest";
import {
  SWIPE_COMMIT_FRACTION,
  SWIPE_REVEAL_THRESHOLD,
  SWIPE_WIDTH_FALLBACK_PX,
  swipeCommitForDelta,
  swipeRevealForDelta,
} from "./swipe-action";

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

describe("swipeCommitForDelta (T84 release-to-commit, pure)", () => {
  it("commits past two thirds of the row width, either direction", () => {
    const width = 300;
    const line = width * SWIPE_COMMIT_FRACTION;
    expect(swipeCommitForDelta(-line, width)).toBe(true);
    expect(swipeCommitForDelta(line, width)).toBe(true);
    expect(swipeCommitForDelta(-(line - 1), width)).toBe(false);
  });

  it("falls back to a fixed width where layout is unavailable (jsdom)", () => {
    const line = SWIPE_WIDTH_FALLBACK_PX * SWIPE_COMMIT_FRACTION;
    expect(swipeCommitForDelta(-line, 0)).toBe(true);
    expect(swipeCommitForDelta(line - 1, 0)).toBe(false);
    expect(swipeCommitForDelta(Number.NaN, 300)).toBe(false);
  });
});
