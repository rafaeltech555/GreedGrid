import type { Cell } from "../lib/types";

/** MIME-ish key used to carry the dragged panel kind in a DnD transfer. */
export const PANEL_KIND_DND = "application/x-greedgrid-panel-kind";

/** The cell that should receive a drop on `dropCellId`, or null if unknown. */
export function resolveDropTarget(
  cells: Cell[],
  dropCellId: string,
): Cell | null {
  return cells.find((c) => c.id === dropCellId) ?? null;
}
