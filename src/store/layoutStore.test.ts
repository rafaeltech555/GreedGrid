import { beforeEach, describe, expect, it } from "vitest";
import {
  selectionMergeable,
  selectionSplittable,
  useLayoutStore,
} from "./layoutStore";
import { cellId } from "../grid/cellId";
import { makePreset } from "../grid/presets";

// Reset the store to a known state before each test.
beforeEach(() => {
  useLayoutStore.setState({ layout: makePreset(9), selectedIds: [] });
});

const s = () => useLayoutStore.getState();

describe("layoutStore", () => {
  it("applyPreset swaps the grid and clears selection", () => {
    s().toggleSelect(cellId(1, 1));
    s().applyPreset(4);
    expect(s().layout.cells).toHaveLength(4);
    expect(s().selectedIds).toEqual([]);
  });

  it("toggleSelect adds then removes an id", () => {
    s().toggleSelect(cellId(1, 1));
    expect(s().selectedIds).toEqual([cellId(1, 1)]);
    s().toggleSelect(cellId(1, 1));
    expect(s().selectedIds).toEqual([]);
  });

  it("merges a rectangular selection and exposes split afterwards", () => {
    [cellId(1, 1), cellId(2, 1), cellId(1, 2), cellId(2, 2)].forEach((id) =>
      s().toggleSelect(id),
    );
    expect(selectionMergeable(s())).toBe(true);
    s().mergeSelected();
    expect(s().layout.cells).toHaveLength(6);
    expect(s().selectedIds).toEqual([]);

    // select the merged cell -> splittable
    s().toggleSelect(cellId(1, 1));
    expect(selectionSplittable(s())).toBe(true);
    s().splitSelected();
    expect(s().layout.cells).toHaveLength(9);
  });

  it("does not merge a non-rectangular selection", () => {
    [cellId(1, 1), cellId(2, 1), cellId(1, 2)].forEach((id) =>
      s().toggleSelect(id),
    );
    expect(selectionMergeable(s())).toBe(false);
    s().mergeSelected();
    expect(s().layout.cells).toHaveLength(9); // unchanged
  });

  it("setCols replaces the column ratios", () => {
    s().applyPreset(4);
    s().setCols([2, 1]);
    expect(s().layout.grid.cols).toEqual([2, 1]);
  });
});
