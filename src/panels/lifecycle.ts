import type { Cell, GridLayout, PanelConfig } from "../lib/types";

type PlacedCell = Cell & { panel: PanelConfig };

/** Panels present in `before` whose `instanceId` is absent from `after`. */
export function panelsRemoved(
  before: GridLayout,
  after: GridLayout,
): PanelConfig[] {
  const placed = (c: Cell): c is PlacedCell => c.panel !== null;
  const liveIds = new Set(
    after.cells.filter(placed).map((c) => c.panel.instanceId),
  );
  return before.cells
    .filter(placed)
    .filter((c) => !liveIds.has(c.panel.instanceId))
    .map((c) => c.panel);
}
