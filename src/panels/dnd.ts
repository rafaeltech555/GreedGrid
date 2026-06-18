import type { Cell } from "../lib/types";

/** MIME-ish key used to carry the dragged panel kind in a DnD transfer. */
export const PANEL_KIND_DND = "application/x-greedgrid-panel-kind";

/** MIME-ish key used to carry the source cellId when moving an existing panel. */
export const PANEL_MOVE_DND = "application/x-greedgrid-panel-move";

/** The cell that should receive a drop on `dropCellId`, or null if unknown. */
export function resolveDropTarget(
  cells: Cell[],
  dropCellId: string,
): Cell | null {
  return cells.find((c) => c.id === dropCellId) ?? null;
}

/**
 * Resolve a panel move operation. Returns `{ from, to }` when all conditions
 * are met: both cells exist, `fromCellId !== toCellId`, and the source cell
 * actually holds a panel. Returns `null` for any guard failure (no-op move).
 */
export function resolveMove(
  cells: Cell[],
  fromCellId: string,
  toCellId: string,
): { from: Cell; to: Cell } | null {
  if (fromCellId === toCellId) return null;
  const from = resolveDropTarget(cells, fromCellId);
  const to = resolveDropTarget(cells, toCellId);
  if (!from || !to || from.panel == null) return null;
  return { from, to };
}
