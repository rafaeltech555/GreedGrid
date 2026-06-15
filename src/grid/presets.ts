import type { Cell, GridLayout } from "../lib/types";
import { cellId } from "./cellId";

/** The preset cell counts offered in the toolbar, mapped to [cols, rows]. */
export const PRESETS = {
  4: [2, 2],
  6: [3, 2],
  8: [4, 2],
  9: [3, 3],
  12: [4, 3],
} as const satisfies Record<number, readonly [number, number]>;

export type PresetCount = keyof typeof PRESETS;

/** Ordered list of preset counts for rendering toolbar buttons. */
export const PRESET_COUNTS = Object.keys(PRESETS)
  .map(Number)
  .sort((a, b) => a - b) as PresetCount[];

export const DEFAULT_GAP = 4;

/**
 * Build a fresh, evenly-divided grid for the given preset count. Every track
 * gets ratio 1 and every cell is span-1 with no panel — a blank dashboard ready
 * to have panels dropped into it.
 */
export function makePreset(count: PresetCount, gap = DEFAULT_GAP): GridLayout {
  const [nCols, nRows] = PRESETS[count];
  const cells: Cell[] = [];
  for (let row = 1; row <= nRows; row++) {
    for (let col = 1; col <= nCols; col++) {
      cells.push({
        id: cellId(col, row),
        col,
        row,
        colSpan: 1,
        rowSpan: 1,
        panel: null,
      });
    }
  }
  return {
    grid: { cols: Array(nCols).fill(1), rows: Array(nRows).fill(1), gap },
    cells,
  };
}
