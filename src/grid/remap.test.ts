import { describe, expect, it } from "vitest";
import { remapToPreset } from "./remap";
import { makePreset } from "./presets";
import { mergeCells } from "./merge";
import { cellId } from "./cellId";
import type { GridLayout } from "../lib/types";

/** Helper: place a panel into a cell by top-left (col, row) */
function withPanel(layout: GridLayout, col: number, row: number, instanceId: string): GridLayout {
  return {
    ...layout,
    cells: layout.cells.map((c) =>
      c.col === col && c.row === row
        ? { ...c, panel: { instanceId, kind: "web", config: {} } }
        : c,
    ),
  };
}

describe("remapToPreset", () => {
  it("4→9: panel at c1-r1 is retained with same instanceId, dropped is empty, 9 cells all span-1", () => {
    const old = withPanel(makePreset(4), 1, 1, "panel-abc");
    const { layout, dropped } = remapToPreset(old, 9);

    expect(layout.cells).toHaveLength(9);
    // All cells are span-1
    for (const cell of layout.cells) {
      expect(cell.colSpan).toBe(1);
      expect(cell.rowSpan).toBe(1);
    }
    // Panel preserved at c1-r1 with same instanceId
    const cell = layout.cells.find((c) => c.id === cellId(1, 1));
    expect(cell?.panel?.instanceId).toBe("panel-abc");
    // Nothing dropped
    expect(dropped).toHaveLength(0);
  });

  it("9→4 dropped: panel at c3-r3 goes into dropped, new layout has 4 cells, no panel at that position", () => {
    const old = withPanel(makePreset(9), 3, 3, "panel-out");
    const { layout, dropped } = remapToPreset(old, 4);

    expect(layout.cells).toHaveLength(4);
    // c3-r3 doesn't exist in a 2×2 grid
    const cell = layout.cells.find((c) => c.col === 3 && c.row === 3);
    expect(cell).toBeUndefined();
    // Panel goes to dropped
    expect(dropped).toHaveLength(1);
    expect(dropped[0].instanceId).toBe("panel-out");
  });

  it("9→4 mixed: c1-r1 retained, c3-r3 dropped", () => {
    let old = makePreset(9);
    old = withPanel(old, 1, 1, "panel-keep");
    old = withPanel(old, 3, 3, "panel-drop");
    const { layout, dropped } = remapToPreset(old, 4);

    expect(layout.cells).toHaveLength(4);
    // c1-r1 panel kept
    const kept = layout.cells.find((c) => c.id === cellId(1, 1));
    expect(kept?.panel?.instanceId).toBe("panel-keep");
    // c3-r3 dropped
    expect(dropped).toHaveLength(1);
    expect(dropped[0].instanceId).toBe("panel-drop");
  });

  it("merged cell uses top-left only: panel in a 2-cell merge at c1-r1 lands in new span-1 c1-r1, nothing dropped", () => {
    // Build a 9-cell layout and place a panel at c1-r1 before merging
    let base = makePreset(9);
    base = withPanel(base, 1, 1, "panel-merged");

    // Merge c1-r1 and c2-r1 into a 2×1 spanning cell, keeping the c1-r1 panel
    const keep = base.cells.find((c) => c.id === cellId(1, 1))!.panel;
    const merged = mergeCells(base, [cellId(1, 1), cellId(2, 1)], keep);

    // Verify the merge took effect: the merged cell spans 2 columns
    const mergedCell = merged.cells.find((c) => c.id === cellId(1, 1));
    expect(mergedCell?.colSpan).toBe(2);
    expect(mergedCell?.panel?.instanceId).toBe("panel-merged");

    // Remap back to a fresh 9-preset: the merged cell's top-left (c1,r1) is used
    const { layout, dropped } = remapToPreset(merged, 9);

    expect(layout.cells).toHaveLength(9);
    // Panel lands in span-1 c1-r1 with instanceId intact
    const target = layout.cells.find((c) => c.id === cellId(1, 1));
    expect(target?.colSpan).toBe(1);
    expect(target?.rowSpan).toBe(1);
    expect(target?.panel?.instanceId).toBe("panel-merged");
    // Nothing was dropped — top-left fits the new grid
    expect(dropped).toHaveLength(0);
  });
});
