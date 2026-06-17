import { useState } from "react";
import {
  selectionMergeable,
  selectionSplittable,
  useLayoutStore,
} from "../store/layoutStore";
import { PRESET_COUNTS, type PresetCount } from "../grid/presets";
import { remapToPreset } from "../grid/remap";
import { ConfirmDialog } from "./ConfirmDialog";
import { WorkspaceMenu } from "./WorkspaceMenu";
import type { PanelConfig } from "../lib/types";

type PendingPreset = {
  count: PresetCount;
  dropped: PanelConfig[];
} | null;

/**
 * Top toolbar: pick a preset grid, and merge/split the current selection.
 * Selection is driven by clicking cells in the grid below.
 *
 * When switching presets, existing panels whose top-left position fits the new
 * grid are preserved in-place (same instanceId). Panels that no longer fit
 * trigger a ConfirmDialog before they are destroyed.
 */
export function Toolbar() {
  const layout = useLayoutStore((s) => s.layout);
  const loadLayout = useLayoutStore((s) => s.loadLayout);
  const mergeSelected = useLayoutStore((s) => s.mergeSelected);
  const splitSelected = useLayoutStore((s) => s.splitSelected);
  const clearSelection = useLayoutStore((s) => s.clearSelection);
  const selectedCount = useLayoutStore((s) => s.selectedIds.length);
  const canMerge = useLayoutStore(selectionMergeable);
  const canSplit = useLayoutStore(selectionSplittable);

  const [pendingPreset, setPendingPreset] = useState<PendingPreset>(null);

  function handlePresetClick(count: PresetCount) {
    const { layout: next, dropped } = remapToPreset(layout, count);
    if (dropped.length === 0) {
      loadLayout(next);
    } else {
      setPendingPreset({ count, dropped });
    }
  }

  return (
    <div className="flex items-center gap-3 border-b border-white/10 px-4 py-2">
      <span className="text-xs font-medium text-white/40">Layout</span>
      <div className="flex gap-1">
        {PRESET_COUNTS.map((count) => (
          <button
            key={count}
            onClick={() => handlePresetClick(count)}
            className="rounded border border-white/10 px-2.5 py-1 text-xs text-white/70 hover:border-emerald-400/50 hover:text-white"
          >
            {count}
          </button>
        ))}
      </div>

      <div className="mx-1 h-4 w-px bg-white/10" />

      <button
        onClick={mergeSelected}
        disabled={!canMerge}
        className="rounded border border-white/10 px-2.5 py-1 text-xs text-white/70 enabled:hover:border-emerald-400/50 enabled:hover:text-white disabled:opacity-30"
      >
        Merge
      </button>
      <button
        onClick={splitSelected}
        disabled={!canSplit}
        className="rounded border border-white/10 px-2.5 py-1 text-xs text-white/70 enabled:hover:border-emerald-400/50 enabled:hover:text-white disabled:opacity-30"
      >
        Split
      </button>

      {selectedCount > 0 && (
        <button
          onClick={clearSelection}
          className="text-xs text-white/40 hover:text-white/70"
        >
          {selectedCount} selected · clear
        </button>
      )}
      <div className="mx-1 h-4 w-px bg-white/10" />
      <WorkspaceMenu />

      {pendingPreset && (
        <ConfirmDialog
          message={`切換到 ${pendingPreset.count} 格會移除 ${pendingPreset.dropped.length} 個放不下的面板，確定嗎？`}
          confirmLabel="切換"
          onConfirm={() => {
            const current = useLayoutStore.getState().layout;
            const { layout: next } = remapToPreset(current, pendingPreset.count);
            loadLayout(next);
            setPendingPreset(null);
          }}
          onCancel={() => setPendingPreset(null)}
        />
      )}
    </div>
  );
}
