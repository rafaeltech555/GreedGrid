import { describe, expect, it } from "vitest";
import { makePreset } from "./presets";
import {
  boundarySegments,
  canMerge,
  cellTracks,
  isMerged,
  isRectangularSelection,
  mergeCells,
  panelsInSelection,
  splitCell,
} from "./merge";
import { cellId } from "./cellId";
import type { PanelConfig } from "../lib/types";

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
    const merged = mergeCells(grid(), ids, null);
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
    expect(() => mergeCells(grid(), ids, null)).toThrow();
  });

  it("keeps the panel passed as `keep`, regardless of which cell it came from", () => {
    const layout = grid();
    // panel lives in the *right* cell, not the top-left
    const panel: PanelConfig = { instanceId: "x", kind: "web", config: {} };
    layout.cells.find((c) => c.id === cellId(2, 1))!.panel = panel;
    const merged = mergeCells(layout, [cellId(1, 1), cellId(2, 1)], panel);
    expect(merged.cells.find((c) => c.id === cellId(1, 1))!.panel).toEqual(panel);
  });

  it("leaves the merged cell empty when `keep` is null", () => {
    const layout = grid();
    layout.cells.find((c) => c.id === cellId(1, 1))!.panel = {
      instanceId: "x",
      kind: "web",
      config: {},
    };
    const merged = mergeCells(layout, [cellId(1, 1), cellId(2, 1)], null);
    expect(merged.cells.find((c) => c.id === cellId(1, 1))!.panel).toBeNull();
  });
});

describe("panelsInSelection", () => {
  it("returns the non-null panels in reading order (row then col)", () => {
    const layout = grid();
    // place in cellId(2,1) then cellId(1,2) — out of reading order on purpose
    layout.cells.find((c) => c.id === cellId(2, 1))!.panel = {
      instanceId: "b",
      kind: "web",
      config: {},
    };
    layout.cells.find((c) => c.id === cellId(1, 2))!.panel = {
      instanceId: "c",
      kind: "terminal",
      config: {},
    };
    const ids = [cellId(1, 2), cellId(2, 1), cellId(1, 1)];
    expect(panelsInSelection(layout, ids).map((p) => p.instanceId)).toEqual([
      "b", // row 1, col 2
      "c", // row 2, col 1
    ]);
  });

  it("returns an empty array when no selected cell has a panel", () => {
    expect(panelsInSelection(grid(), [cellId(1, 1), cellId(2, 1)])).toEqual([]);
  });
});

describe("splitCell", () => {
  it("round-trips: merge then split restores 9 unit cells", () => {
    const ids = [cellId(1, 1), cellId(2, 1), cellId(1, 2), cellId(2, 2)];
    const merged = mergeCells(grid(), ids, null);
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

describe("boundarySegments", () => {
  const cell = (col: number, row: number, colSpan: number, rowSpan: number) => ({
    id: cellId(col, row),
    col,
    row,
    colSpan,
    rowSpan,
    panel: null,
  });

  it("no merge: whole boundary is one segment", () => {
    const cells = makePreset(9).cells;
    expect(boundarySegments(cells, "col", 1, 3)).toEqual([{ start: 1, end: 3 }]);
  });

  it("a cell spanning the full boundary leaves no segment", () => {
    const cells = [cell(1, 1, 2, 3)];
    expect(boundarySegments(cells, "col", 1, 3)).toEqual([]);
  });

  it("a partial (top-row) span clips that row only", () => {
    const cells = [cell(1, 1, 2, 1)];
    expect(boundarySegments(cells, "col", 1, 3)).toEqual([{ start: 2, end: 3 }]);
  });

  it("spans at top and bottom leave a hole in the middle", () => {
    const cells = [cell(1, 1, 2, 1), cell(1, 3, 2, 1)];
    expect(boundarySegments(cells, "col", 1, 3)).toEqual([{ start: 2, end: 2 }]);
  });

  it("row axis: a cell spanning row1-2 across all cols blocks row boundary 1", () => {
    const cells = [cell(1, 1, 3, 2)];
    expect(boundarySegments(cells, "row", 1, 3)).toEqual([]);
  });
});
