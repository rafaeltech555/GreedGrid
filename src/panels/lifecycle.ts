import type { GridLayout, PanelConfig } from "../lib/types";

/** Panels present in `before` whose `instanceId` is absent from `after`. */
export function panelsRemoved(
  before: GridLayout,
  after: GridLayout,
): PanelConfig[] {
  const liveIds = new Set(
    after.cells
      .filter((c) => c.panel)
      .map((c) => (c.panel as PanelConfig).instanceId),
  );
  return before.cells
    .filter((c) => c.panel && !liveIds.has((c.panel as PanelConfig).instanceId))
    .map((c) => c.panel as PanelConfig);
}
