import type { Cell, GridLayout } from "../lib/types";
import { cellId } from "./cellId";

/** Bounding box of a set of cells, in 1-based inclusive track coordinates. */
export interface BBox {
  minCol: number;
  minRow: number;
  maxCol: number;
  maxRow: number;
}

/** Whether a cell spans more than one track in either axis. */
export function isMerged(cell: Cell): boolean {
  return cell.colSpan > 1 || cell.rowSpan > 1;
}

/** All [col, row] track coordinates a cell occupies. */
export function cellTracks(cell: Cell): Array<[number, number]> {
  const tracks: Array<[number, number]> = [];
  for (let r = cell.row; r < cell.row + cell.rowSpan; r++) {
    for (let c = cell.col; c < cell.col + cell.colSpan; c++) {
      tracks.push([c, r]);
    }
  }
  return tracks;
}

function resolve(layout: GridLayout, ids: string[]): Cell[] {
  const byId = new Map(layout.cells.map((c) => [c.id, c]));
  return ids.map((id) => byId.get(id)).filter((c): c is Cell => c != null);
}

function bbox(cells: Cell[]): BBox {
  let minCol = Infinity;
  let minRow = Infinity;
  let maxCol = -Infinity;
  let maxRow = -Infinity;
  for (const c of cells) {
    minCol = Math.min(minCol, c.col);
    minRow = Math.min(minRow, c.row);
    maxCol = Math.max(maxCol, c.col + c.colSpan - 1);
    maxRow = Math.max(maxRow, c.row + c.rowSpan - 1);
  }
  return { minCol, minRow, maxCol, maxRow };
}

/**
 * True when the selected cells exactly tile their bounding box — every track in
 * the box is covered by exactly one selected cell, with no gaps, no overlaps,
 * and nothing spilling outside. This is the precondition for a clean merge.
 */
export function isRectangularSelection(
  layout: GridLayout,
  ids: string[],
): boolean {
  const sel = resolve(layout, ids);
  if (sel.length === 0) return false;

  const box = bbox(sel);
  const boxArea =
    (box.maxCol - box.minCol + 1) * (box.maxRow - box.minRow + 1);

  const covered = new Set<string>();
  for (const cell of sel) {
    for (const [col, row] of cellTracks(cell)) {
      if (
        col < box.minCol ||
        col > box.maxCol ||
        row < box.minRow ||
        row > box.maxRow
      ) {
        return false; // outside the box (can't happen given bbox, but explicit)
      }
      const key = `${col},${row}`;
      if (covered.has(key)) return false; // overlap
      covered.add(key);
    }
  }
  return covered.size === boxArea; // fully tiled, no gaps
}

/** Whether `ids` form a mergeable selection (a rectangle of 2+ cells). */
export function canMerge(layout: GridLayout, ids: string[]): boolean {
  return ids.length >= 2 && isRectangularSelection(layout, ids);
}

/**
 * Merge a rectangular selection into one spanning cell at the box's top-left.
 * The top-left cell's panel is preserved; the rest are discarded. Tracks are not
 * removed — the merged cell simply spans them. Throws if the selection is not a
 * clean rectangle (guard with `canMerge`).
 */
export function mergeCells(layout: GridLayout, ids: string[]): GridLayout {
  if (!canMerge(layout, ids)) {
    throw new Error("selection is not a mergeable rectangle");
  }
  const sel = resolve(layout, ids);
  const box = bbox(sel);
  const topLeft = sel.find(
    (c) => c.col === box.minCol && c.row === box.minRow,
  )!;

  const merged: Cell = {
    id: cellId(box.minCol, box.minRow),
    col: box.minCol,
    row: box.minRow,
    colSpan: box.maxCol - box.minCol + 1,
    rowSpan: box.maxRow - box.minRow + 1,
    panel: topLeft.panel,
  };

  const idSet = new Set(ids);
  const remaining = layout.cells.filter((c) => !idSet.has(c.id));
  return { ...layout, cells: [...remaining, merged] };
}

/** 一段未被 spanning cell 跨越的 cross-axis track 連續區間(1-based, inclusive)。 */
export interface SplitterSegment {
  start: number;
  end: number;
}

/**
 * 給定 cells、邊界軸與邊界 index,回傳該邊界上「沒有 cell 跨越」的 cross-axis
 * track 連續區間清單。
 *
 * 座標(沿用本檔 1-based track 約定):
 * - axis="col" 時,邊界 `boundaryIndex` 位於 column k 與 k+1 之間;cell 跨越它
 *   當 `cell.col <= k && cell.col + cell.colSpan - 1 >= k+1`,遮蔽其 row 範圍。
 * - axis="row" 對稱(交換 col/row)。
 *
 * 無 merge → 整條一段;被跨越處切掉,中間可留洞。
 */
export function boundarySegments(
  cells: Cell[],
  axis: "col" | "row",
  boundaryIndex: number,
  crossTrackCount: number,
): SplitterSegment[] {
  const occluded = new Array<boolean>(crossTrackCount + 1).fill(false);
  for (const c of cells) {
    const crosses =
      axis === "col"
        ? c.col <= boundaryIndex && c.col + c.colSpan - 1 >= boundaryIndex + 1
        : c.row <= boundaryIndex && c.row + c.rowSpan - 1 >= boundaryIndex + 1;
    if (!crosses) continue;
    const lo = axis === "col" ? c.row : c.col;
    const hi = axis === "col" ? c.row + c.rowSpan - 1 : c.col + c.colSpan - 1;
    for (let t = lo; t <= hi; t++) {
      if (t >= 1 && t <= crossTrackCount) occluded[t] = true;
    }
  }

  const segments: SplitterSegment[] = [];
  let runStart: number | null = null;
  for (let t = 1; t <= crossTrackCount; t++) {
    if (!occluded[t]) {
      if (runStart === null) runStart = t;
    } else if (runStart !== null) {
      segments.push({ start: runStart, end: t - 1 });
      runStart = null;
    }
  }
  if (runStart !== null) segments.push({ start: runStart, end: crossTrackCount });
  return segments;
}

/**
 * Split a merged cell back into span-1 cells, one per track it covered. The
 * top-left fragment inherits the panel; the rest become empty. No-op for an
 * already-unit cell.
 */
export function splitCell(layout: GridLayout, id: string): GridLayout {
  const cell = layout.cells.find((c) => c.id === id);
  if (!cell) throw new Error(`no cell ${id}`);
  if (!isMerged(cell)) return layout;

  const fragments: Cell[] = cellTracks(cell).map(([col, row]) => ({
    id: cellId(col, row),
    col,
    row,
    colSpan: 1,
    rowSpan: 1,
    panel: col === cell.col && row === cell.row ? cell.panel : null,
  }));

  return {
    ...layout,
    cells: [...layout.cells.filter((c) => c.id !== id), ...fragments],
  };
}
