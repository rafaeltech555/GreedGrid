import { describe, expect, it } from "vitest";
import { webReady } from "./types";

describe("webReady", () => {
  it("is false for empty or whitespace url", () => {
    expect(webReady({ url: "" })).toBe(false);
    expect(webReady({ url: "   " })).toBe(false);
    expect(webReady({})).toBe(false);
  });

  it("is true for a non-empty url", () => {
    expect(webReady({ url: "https://example.com" })).toBe(true);
  });
});
