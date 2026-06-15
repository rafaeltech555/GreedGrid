import { create } from "zustand";
import type { GridLayout } from "../lib/types";
import { makePreset, type PresetCount } from "../grid/presets";
import { canMerge, isMerged, mergeCells, splitCell } from "../grid/merge";

interface LayoutState {
  /** The persisted-shape layout document (geometry + cells). */
  layout: GridLayout;
  /** Ids of cells currently selected for a merge/split operation (ephemeral). */
  selectedIds: string[];

  applyPreset: (count: PresetCount) => void;
  toggleSelect: (id: string) => void;
  clearSelection: () => void;
  mergeSelected: () => void;
  splitSelected: () => void;
  setCols: (cols: number[]) => void;
  setRows: (rows: number[]) => void;
}

/** Whether the current selection can be merged into one cell. */
export function selectionMergeable(s: LayoutState): boolean {
  return canMerge(s.layout, s.selectedIds);
}

/** The single merged cell selected for splitting, if exactly that is selected. */
export function selectionSplittable(s: LayoutState): boolean {
  if (s.selectedIds.length !== 1) return false;
  const cell = s.layout.cells.find((c) => c.id === s.selectedIds[0]);
  return cell != null && isMerged(cell);
}

export const useLayoutStore = create<LayoutState>((set) => ({
  layout: makePreset(4),
  selectedIds: [],

  applyPreset: (count) =>
    set({ layout: makePreset(count), selectedIds: [] }),

  toggleSelect: (id) =>
    set((s) => ({
      selectedIds: s.selectedIds.includes(id)
        ? s.selectedIds.filter((x) => x !== id)
        : [...s.selectedIds, id],
    })),

  clearSelection: () => set({ selectedIds: [] }),

  mergeSelected: () =>
    set((s) => {
      if (!canMerge(s.layout, s.selectedIds)) return s;
      return {
        layout: mergeCells(s.layout, s.selectedIds),
        selectedIds: [],
      };
    }),

  splitSelected: () =>
    set((s) => {
      if (!selectionSplittable(s)) return s;
      return {
        layout: splitCell(s.layout, s.selectedIds[0]),
        selectedIds: [],
      };
    }),

  setCols: (cols) =>
    set((s) => ({ layout: { ...s.layout, grid: { ...s.layout.grid, cols } } })),

  setRows: (rows) =>
    set((s) => ({ layout: { ...s.layout, grid: { ...s.layout.grid, rows } } })),
}));
