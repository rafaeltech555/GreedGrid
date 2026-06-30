import type { Cell } from "../lib/types";

/**
 * Whether a currently-maximized cell must be restored. True when nothing keeps
 * the maximize valid: the target cell vanished (merge/split/preset/workspace
 * load) or the user entered select mode (maximize and selection must not
 * coexist). False when nothing is maximized.
 */
export function shouldRestoreMaximize(
  cells: Cell[],
  maximizedCellId: string | null,
  selectMode: boolean,
): boolean {
  if (maximizedCellId === null) return false;
  if (selectMode) return true;
  return !cells.some((c) => c.id === maximizedCellId);
}
