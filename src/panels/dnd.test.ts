import { describe, expect, it } from "vitest";
import { resolveDropTarget } from "./dnd";
import type { Cell } from "../lib/types";

const cell = (id: string): Cell => ({
  id,
  col: 1,
  row: 1,
  colSpan: 1,
  rowSpan: 1,
  panel: null,
});

describe("resolveDropTarget", () => {
  it("returns the cell matching the drop id", () => {
    const cells = [cell("a"), cell("b")];
    expect(resolveDropTarget(cells, "b")?.id).toBe("b");
  });

  it("returns null when no cell matches", () => {
    expect(resolveDropTarget([cell("a")], "zzz")).toBeNull();
  });
});
