import { create } from "zustand";
import type { GridLayout, PanelKind } from "../lib/types";
import { makePreset } from "../grid/presets";
import { canMerge, isMerged, mergeCells, splitCell } from "../grid/merge";
import { getPanelType } from "../panels/registry";
import { panelsRemoved } from "../panels/lifecycle";

interface LayoutState {
  /** The persisted-shape layout document (geometry + cells). */
  layout: GridLayout;
  /** Ids of cells currently selected for a merge/split operation (ephemeral). */
  selectedIds: string[];
  /** 選取模式:開啟時 grid cell 用 overlay 攔截點擊以便選取(ephemeral)。 */
  selectMode: boolean;

  loadLayout: (layout: GridLayout) => void;
  toggleSelect: (id: string) => void;
  clearSelection: () => void;
  setSelectMode: (on: boolean) => void;
  toggleSelectMode: () => void;
  mergeSelected: () => void;
  splitSelected: () => void;
  setCols: (cols: number[]) => void;
  setRows: (rows: number[]) => void;
  setPanel: (
    cellId: string,
    kind: PanelKind,
    initialConfig?: Record<string, unknown>,
    idGen?: () => string,
  ) => void;
  updatePanelConfig: (cellId: string, config: Record<string, unknown>) => void;
  clearPanel: (cellId: string) => void;
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

/** Fire onDestroy for every panel that exists in `before` but not `after`. */
function fireDestroyed(before: GridLayout, after: GridLayout): void {
  for (const panel of panelsRemoved(before, after)) {
    getPanelType(panel.kind)?.onDestroy?.(panel.instanceId, panel.config);
  }
}

export const useLayoutStore = create<LayoutState>((set) => ({
  layout: makePreset(4),
  selectedIds: [],
  selectMode: false,

  loadLayout: (layout) =>
    set((s) => {
      fireDestroyed(s.layout, layout);
      return { layout, selectedIds: [] };
    }),

  toggleSelect: (id) =>
    set((s) => ({
      selectedIds: s.selectedIds.includes(id)
        ? s.selectedIds.filter((x) => x !== id)
        : [...s.selectedIds, id],
    })),

  clearSelection: () => set({ selectedIds: [] }),

  setSelectMode: (on) =>
    set(() => (on ? { selectMode: true } : { selectMode: false, selectedIds: [] })),

  toggleSelectMode: () =>
    set((s) =>
      s.selectMode ? { selectMode: false, selectedIds: [] } : { selectMode: true },
    ),

  mergeSelected: () =>
    set((s) => {
      if (!canMerge(s.layout, s.selectedIds)) return s;
      const after = mergeCells(s.layout, s.selectedIds);
      fireDestroyed(s.layout, after);
      return { layout: after, selectedIds: [], selectMode: false };
    }),

  // No fireDestroyed needed: a merged cell holds only the top-left panel, which
  // splitCell preserves in the top-left fragment — split never drops a live panel.
  splitSelected: () =>
    set((s) => {
      if (!selectionSplittable(s)) return s;
      return {
        layout: splitCell(s.layout, s.selectedIds[0]),
        selectedIds: [],
        selectMode: false,
      };
    }),

  setCols: (cols) =>
    set((s) => ({ layout: { ...s.layout, grid: { ...s.layout.grid, cols } } })),

  setRows: (rows) =>
    set((s) => ({ layout: { ...s.layout, grid: { ...s.layout.grid, rows } } })),

  setPanel: (cellId, kind, initialConfig, idGen = () => crypto.randomUUID()) =>
    set((s) => {
      const def = getPanelType(kind);
      if (!def) return s;
      const target = s.layout.cells.find((c) => c.id === cellId);
      if (!target) return s;
      const after: GridLayout = {
        ...s.layout,
        cells: s.layout.cells.map((c) =>
          c.id === cellId
            ? {
                ...c,
                panel: {
                  instanceId: idGen(),
                  kind,
                  config: initialConfig ?? def.defaultConfig(),
                },
              }
            : c,
        ),
      };
      fireDestroyed(s.layout, after);
      return { layout: after };
    }),

  updatePanelConfig: (cellId, config) =>
    set((s) => ({
      layout: {
        ...s.layout,
        cells: s.layout.cells.map((c) =>
          c.id === cellId && c.panel
            ? { ...c, panel: { ...c.panel, config } }
            : c,
        ),
      },
    })),

  clearPanel: (cellId) =>
    set((s) => {
      const after: GridLayout = {
        ...s.layout,
        cells: s.layout.cells.map((c) =>
          c.id === cellId ? { ...c, panel: null } : c,
        ),
      };
      fireDestroyed(s.layout, after);
      return { layout: after };
    }),
}));
