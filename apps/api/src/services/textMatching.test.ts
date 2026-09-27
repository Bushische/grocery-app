import { describe, expect, it } from "vitest";
import { bigrams, diceCoefficient, escapeLike } from "./textMatching";

describe("bigrams", () => {
  it("lowercases and returns unique character pairs", () => {
    expect(bigrams("Milk")).toEqual(new Set(["mi", "il", "lk"]));
    expect(bigrams("aa aa")).toEqual(new Set(["aa", "a ", " a"]));
  });

  it("is empty for strings shorter than two characters", () => {
    expect(bigrams("")).toEqual(new Set());
    expect(bigrams("m")).toEqual(new Set());
  });
});

describe("diceCoefficient", () => {
  it("returns 1 for identical strings regardless of case", () => {
    expect(diceCoefficient("Milk", "milk")).toBe(1);
  });

  it("scores a near-match above the 0.6 smart-add threshold", () => {
    // docs/API.md example: "semi milk" typed for "Semi-skimmed Milk".
    expect(diceCoefficient("semi skimmed milk", "Semi-skimmed Milk")).toBeGreaterThan(0.6);
    expect(diceCoefficient("semi-skimmed milk", "semi-skimmed milk")).toBe(1);
  });

  it("scores unrelated words at 0", () => {
    expect(diceCoefficient("milk", "butter")).toBe(0);
    expect(diceCoefficient("milk", "")).toBe(0);
  });

  it("treats single-character inputs as exact-or-nothing", () => {
    expect(diceCoefficient("m", "m")).toBe(1);
    expect(diceCoefficient("m", "k")).toBe(0);
    expect(diceCoefficient("m", "milk")).toBe(0);
  });
});

describe("escapeLike", () => {
  it("escapes backslash, percent, and underscore", () => {
    expect(escapeLike("50% off_milk\\")).toBe("50\\% off\\_milk\\\\");
  });

  it("leaves plain text untouched", () => {
    expect(escapeLike("semi milk")).toBe("semi milk");
  });
});
