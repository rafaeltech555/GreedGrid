import { describe, expect, it } from "vitest";
import { resolveDropTarget, resolveMove } from "./dnd";
import type { Cell, PanelConfig } from "../lib/types";

const cell = (id: string): Cell => ({
  id,
  col: 1,
  row: 1,
  colSpan: 1,
  rowSpan: 1,
  panel: null,
});

const panel = (instanceId: string): PanelConfig => ({
  instanceId,
  kind: "web",
  config: {},
});

describe("resolveDropTarget", () => {
  it("returns the cell matching the drop id", () => {
    const cells = [cell("a"), cell("b")];
    expect(resolveDropTarget(cells, "b")?.id).toBe("b");
  });

  it("returns null when no cell matches", () => {
    expect(resolveDropTarget([cell("a")], "zzz")).toBeNull();
  });
});

describe("resolveMove", () => {
  it("returns { from, to } when from has a panel and ids differ", () => {
    const cells = [
      { ...cell("a"), panel: panel("p-a") },
      cell("b"),
    ];
    const result = resolveMove(cells, "a", "b");
    expect(result).not.toBeNull();
    expect(result?.from.id).toBe("a");
    expect(result?.to.id).toBe("b");
  });

  it("returns null when fromId === toId", () => {
    const cells = [{ ...cell("a"), panel: panel("p-a") }];
    expect(resolveMove(cells, "a", "a")).toBeNull();
  });

  it("returns null when from cell has no panel", () => {
    const cells = [cell("a"), cell("b")];
    expect(resolveMove(cells, "a", "b")).toBeNull();
  });

  it("returns null when from cell does not exist", () => {
    const cells = [cell("b")];
    expect(resolveMove(cells, "zzz", "b")).toBeNull();
  });

  it("returns null when to cell does not exist", () => {
    const cells = [{ ...cell("a"), panel: panel("p-a") }];
    expect(resolveMove(cells, "a", "zzz")).toBeNull();
  });
});
