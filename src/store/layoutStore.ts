import { create } from "zustand";
import type { GridLayout, PanelConfig, PanelKind } from "../lib/types";
import { makePreset } from "../grid/presets";
import {
  canMerge,
  isMerged,
  mergeCells,
  panelsInSelection,
  splitCell,
} from "../grid/merge";
import { getPanelType } from "../panels/registry";
import { panelsRemoved } from "../panels/lifecycle";
import { usePanelUiStore } from "../panels/panelUiStore";

/**
 * Outcome of `mergeSelected`. A merge with ≤1 live panel completes immediately
 * (`conflict: false`). With 2+ live panels it cannot decide which to keep, so it
 * leaves the layout untouched and hands the candidates back for the UI to ask;
 * the choice is then committed via `resolveMerge`.
 */
export type MergeResult =
  | { conflict: false }
  | { conflict: true; candidates: PanelConfig[] };

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
  mergeSelected: () => MergeResult;
  resolveMerge: (keepInstanceId: string) => void;
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
  movePanel: (fromCellId: string, toCellId: string) => void;
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

export const useLayoutStore = create<LayoutState>((set, get) => ({
  layout: makePreset(4),
  selectedIds: [],
  selectMode: false,

  loadLayout: (layout) => {
    fireDestroyed(get().layout, layout);
    // A wholesale layout replacement invalidates any maximize: positional cell
    // ids can survive the swap, so we cannot rely on id-disappearance to restore.
    usePanelUiStore.getState().restoreCell();
    set({ layout, selectedIds: [] });
  },

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

  // ≤1 live panel → merge now, keeping that lone panel (or empty). 2+ → signal a
  // conflict and leave the layout alone; the UI resolves it via resolveMerge.
  mergeSelected: () => {
    const s = get();
    if (!canMerge(s.layout, s.selectedIds)) return { conflict: false };
    const panels = panelsInSelection(s.layout, s.selectedIds);
    if (panels.length >= 2) return { conflict: true, candidates: panels };
    const keep = panels[0] ?? null;
    const after = mergeCells(s.layout, s.selectedIds, keep);
    fireDestroyed(s.layout, after);
    set({ layout: after, selectedIds: [], selectMode: false });
    return { conflict: false };
  },

  resolveMerge: (keepInstanceId) =>
    set((s) => {
      if (!canMerge(s.layout, s.selectedIds)) return s;
      const keep =
        panelsInSelection(s.layout, s.selectedIds).find(
          (p) => p.instanceId === keepInstanceId,
        ) ?? null;
      const after = mergeCells(s.layout, s.selectedIds, keep);
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

  movePanel: (fromCellId, toCellId) =>
    set((s) => {
      const from = s.layout.cells.find((c) => c.id === fromCellId);
      const to = s.layout.cells.find((c) => c.id === toCellId);
      // Guard mirrors resolveMove() in dnd.ts — keep the two in sync.
      if (!from || !to || fromCellId === toCellId || from.panel == null) return s;
      const after: GridLayout = {
        ...s.layout,
        cells: s.layout.cells.map((c) => {
          if (c.id === fromCellId) return { ...c, panel: to.panel };
          if (c.id === toCellId) return { ...c, panel: from.panel };
          return c;
        }),
      };
      fireDestroyed(s.layout, after);
      return { layout: after };
    }),
}));
