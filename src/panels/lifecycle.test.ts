import { describe, expect, it } from "vitest";
import { panelsRemoved } from "./lifecycle";
import type { GridLayout, PanelConfig } from "../lib/types";

const panel = (instanceId: string): PanelConfig => ({
  instanceId,
  kind: "web",
  config: { url: "https://x" },
});

const layout = (panels: (PanelConfig | null)[]): GridLayout => ({
  grid: { cols: [1], rows: [1], gap: 4 },
  cells: panels.map((p, i) => ({
    id: `c${i}`,
    col: i + 1,
    row: 1,
    colSpan: 1,
    rowSpan: 1,
    panel: p,
  })),
});

describe("panelsRemoved", () => {
  it("returns panels present before but gone after", () => {
    const before = layout([panel("a"), panel("b")]);
    const after = layout([panel("a"), null]);
    expect(panelsRemoved(before, after).map((p) => p.instanceId)).toEqual(["b"]);
  });

  it("returns nothing when all instanceIds survive", () => {
    const before = layout([panel("a")]);
    const after = layout([panel("a")]);
    expect(panelsRemoved(before, after)).toEqual([]);
  });

  it("treats a replaced instanceId in the same cell as removed", () => {
    const before = layout([panel("a")]);
    const after = layout([panel("z")]);
    expect(panelsRemoved(before, after).map((p) => p.instanceId)).toEqual(["a"]);
  });
});
