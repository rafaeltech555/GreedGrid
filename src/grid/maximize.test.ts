import { describe, expect, it } from "vitest";
import { shouldRestoreMaximize } from "./maximize";
import type { Cell } from "../lib/types";

const cell = (id: string): Cell => ({
  id,
  col: 1,
  row: 1,
  colSpan: 1,
  rowSpan: 1,
  panel: null,
});

describe("shouldRestoreMaximize", () => {
  it("returns false when nothing is maximized", () => {
    expect(shouldRestoreMaximize([cell("a")], null, false)).toBe(false);
  });

  it("returns false when the maximized cell still exists and not selecting", () => {
    expect(shouldRestoreMaximize([cell("a"), cell("b")], "a", false)).toBe(
      false,
    );
  });

  it("returns true when the maximized cell no longer exists", () => {
    expect(shouldRestoreMaximize([cell("b")], "a", false)).toBe(true);
  });

  it("returns true when select mode is entered while maximized", () => {
    expect(shouldRestoreMaximize([cell("a")], "a", true)).toBe(true);
  });
});
