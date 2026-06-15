import { describe, expect, it } from "vitest";
import { makePreset, PRESET_COUNTS, PRESETS } from "./presets";

describe("makePreset", () => {
  it("exposes the expected preset counts in order", () => {
    expect(PRESET_COUNTS).toEqual([4, 6, 8, 9, 12]);
  });

  it.each(PRESET_COUNTS)("preset %i has that many span-1 cells", (count) => {
    const layout = makePreset(count);
    expect(layout.cells).toHaveLength(count);
    expect(layout.cells.every((c) => c.colSpan === 1 && c.rowSpan === 1)).toBe(
      true,
    );
    expect(layout.cells.every((c) => c.panel === null)).toBe(true);
  });

  it("builds the right track counts and even ratios", () => {
    const [cols, rows] = PRESETS[12];
    const layout = makePreset(12);
    expect(layout.grid.cols).toEqual(Array(cols).fill(1));
    expect(layout.grid.rows).toEqual(Array(rows).fill(1));
  });

  it("gives every cell a unique id and valid 1-based coordinates", () => {
    const layout = makePreset(9);
    const ids = new Set(layout.cells.map((c) => c.id));
    expect(ids.size).toBe(9);
    for (const c of layout.cells) {
      expect(c.col).toBeGreaterThanOrEqual(1);
      expect(c.row).toBeGreaterThanOrEqual(1);
      expect(c.col).toBeLessThanOrEqual(3);
      expect(c.row).toBeLessThanOrEqual(3);
    }
  });
});
