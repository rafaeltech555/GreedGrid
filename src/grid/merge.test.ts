import { describe, expect, it } from "vitest";
import { makePreset } from "./presets";
import {
  canMerge,
  cellTracks,
  isMerged,
  isRectangularSelection,
  mergeCells,
  splitCell,
} from "./merge";
import { cellId } from "./cellId";

// A 3×3 grid: ids are c<col>-r<row>.
const grid = () => makePreset(9);

describe("isRectangularSelection", () => {
  it("accepts a 2×2 block (top-left quad)", () => {
    const ids = [cellId(1, 1), cellId(2, 1), cellId(1, 2), cellId(2, 2)];
    expect(isRectangularSelection(grid(), ids)).toBe(true);
  });

  it("accepts a single row span", () => {
    const ids = [cellId(1, 1), cellId(2, 1), cellId(3, 1)];
    expect(isRectangularSelection(grid(), ids)).toBe(true);
  });

  it("rejects an L-shape (not a rectangle)", () => {
    const ids = [cellId(1, 1), cellId(2, 1), cellId(1, 2)];
    expect(isRectangularSelection(grid(), ids)).toBe(false);
  });

  it("rejects a diagonal (gap inside the bounding box)", () => {
    const ids = [cellId(1, 1), cellId(2, 2)];
    expect(isRectangularSelection(grid(), ids)).toBe(false);
  });

  it("rejects an empty selection", () => {
    expect(isRectangularSelection(grid(), [])).toBe(false);
  });
});

describe("canMerge", () => {
  it("needs at least two cells", () => {
    expect(canMerge(grid(), [cellId(1, 1)])).toBe(false);
  });
  it("is true for a clean rectangle of 2+", () => {
    expect(canMerge(grid(), [cellId(1, 1), cellId(2, 1)])).toBe(true);
  });
});

describe("mergeCells", () => {
  it("replaces a 2×2 block with one spanning cell at the top-left", () => {
    const ids = [cellId(1, 1), cellId(2, 1), cellId(1, 2), cellId(2, 2)];
    const merged = mergeCells(grid(), ids);
    // 9 cells - 4 merged + 1 = 6
    expect(merged.cells).toHaveLength(6);
    const big = merged.cells.find((c) => c.id === cellId(1, 1))!;
    expect(big.colSpan).toBe(2);
    expect(big.rowSpan).toBe(2);
    expect(isMerged(big)).toBe(true);
    // tracks remain (3×3), the cell simply spans them
    expect(merged.grid.cols).toHaveLength(3);
  });

  it("throws on a non-rectangular selection", () => {
    const ids = [cellId(1, 1), cellId(2, 1), cellId(1, 2)];
    expect(() => mergeCells(grid(), ids)).toThrow();
  });

  it("preserves the top-left cell's panel", () => {
    const layout = grid();
    layout.cells.find((c) => c.id === cellId(1, 1))!.panel = {
      instanceId: "x",
      kind: "web",
      config: {},
    };
    const merged = mergeCells(layout, [cellId(1, 1), cellId(2, 1)]);
    expect(merged.cells.find((c) => c.id === cellId(1, 1))!.panel?.kind).toBe(
      "web",
    );
  });
});

describe("splitCell", () => {
  it("round-trips: merge then split restores 9 unit cells", () => {
    const ids = [cellId(1, 1), cellId(2, 1), cellId(1, 2), cellId(2, 2)];
    const merged = mergeCells(grid(), ids);
    const split = splitCell(merged, cellId(1, 1));
    expect(split.cells).toHaveLength(9);
    expect(split.cells.every((c) => !isMerged(c))).toBe(true);
    const restoredIds = new Set(split.cells.map((c) => c.id));
    expect(restoredIds.size).toBe(9);
  });

  it("is a no-op for an unmerged cell", () => {
    const layout = grid();
    expect(splitCell(layout, cellId(1, 1))).toBe(layout);
  });
});

describe("cellTracks", () => {
  it("enumerates every track a merged cell covers", () => {
    const tracks = cellTracks({
      id: "x",
      col: 2,
      row: 1,
      colSpan: 2,
      rowSpan: 2,
      panel: null,
    });
    expect(tracks).toHaveLength(4);
    expect(tracks).toContainEqual([3, 2]);
  });
});
