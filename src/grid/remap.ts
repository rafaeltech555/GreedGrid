import type { GridLayout, PanelConfig } from "../lib/types";
import { makePreset, type PresetCount } from "./presets";

/**
 * Remap an existing layout onto a new preset grid without destroying panels
 * that fit within the new bounds. Panels whose top-left (col, row) falls
 * outside the new grid are collected into `dropped` for the caller to handle.
 *
 * Pure function — no store mutations, no onDestroy calls.
 */
export function remapToPreset(
  old: GridLayout,
  count: PresetCount,
): { layout: GridLayout; dropped: PanelConfig[] } {
  const newLayout = makePreset(count);
  const dropped: PanelConfig[] = [];

  for (const oldCell of old.cells) {
    if (!oldCell.panel) continue;

    // Only use the top-left (col, row) of the old cell (merges collapse to span-1)
    // Grid is tiny (≤12 cells); a linear scan per panel is fine.
    const target = newLayout.cells.find(
      (c) => c.col === oldCell.col && c.row === oldCell.row,
    );

    if (target) {
      // newLayout came from makePreset (freshly built each call), so mutating its cells in place is safe.
      target.panel = oldCell.panel;
    } else {
      dropped.push(oldCell.panel);
    }
  }

  return { layout: newLayout, dropped };
}
