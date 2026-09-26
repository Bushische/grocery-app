import { describe, expect, it } from "vitest";
import { API_BASE_PATH } from "./index";

describe("shared package", () => {
  it("exports the API base path", () => {
    expect(API_BASE_PATH).toBe("/api");
  });
});
