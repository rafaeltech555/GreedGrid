import { useEffect, useState } from "react";
import {
  selectionMergeable,
  selectionSplittable,
  useLayoutStore,
} from "../store/layoutStore";
import { PRESET_COUNTS, type PresetCount } from "../grid/presets";
import { remapToPreset } from "../grid/remap";
import { ConfirmDialog } from "./ConfirmDialog";
import { MergeConflictDialog } from "./MergeConflictDialog";
import { WorkspaceMenu } from "./WorkspaceMenu";
import type { PanelConfig } from "../lib/types";
import { useIdleStore } from "../store/idleStore";
import { IdleIcon } from "./IdleIcon";

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
  const resolveMerge = useLayoutStore((s) => s.resolveMerge);
  const splitSelected = useLayoutStore((s) => s.splitSelected);
  const clearSelection = useLayoutStore((s) => s.clearSelection);
  const selectMode = useLayoutStore((s) => s.selectMode);
  const toggleSelectMode = useLayoutStore((s) => s.toggleSelectMode);
  const setSelectMode = useLayoutStore((s) => s.setSelectMode);
  const selectedCount = useLayoutStore((s) => s.selectedIds.length);
  const canMerge = useLayoutStore(selectionMergeable);
  const canSplit = useLayoutStore(selectionSplittable);

  const anyIdle = useIdleStore((s) => s.anyIdle());
  const clearAllIdle = useIdleStore((s) => s.clearAll);

  const [pendingPreset, setPendingPreset] = useState<PendingPreset>(null);
  // Candidates awaiting a "keep which panel?" choice when a merge hits a
  // 2+-panel conflict (mirrors the pendingPreset pattern above).
  const [mergeCandidates, setMergeCandidates] = useState<PanelConfig[] | null>(
    null,
  );

  useEffect(() => {
    if (!selectMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectMode(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selectMode, setSelectMode]);

  function handleMergeClick() {
    const result = mergeSelected();
    if (result.conflict) setMergeCandidates(result.candidates);
  }

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
        onClick={toggleSelectMode}
        aria-pressed={selectMode}
        className={`rounded border px-2.5 py-1 text-xs ${
          selectMode
            ? "border-emerald-400 bg-emerald-400/10 text-emerald-300"
            : "border-white/10 text-white/70 hover:border-emerald-400/50 hover:text-white"
        }`}
      >
        Select
      </button>

      <button
        onClick={handleMergeClick}
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

      <div className="ml-auto">
        <button
          type="button"
          onClick={() => clearAllIdle(Date.now())}
          aria-label={anyIdle ? "閒置 — 點擊清除全部" : "活動中"}
          title={anyIdle ? "有 terminal 跑完待查看 — 點擊清除" : "目前無待辦"}
          className={`flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs ${
            anyIdle
              ? "border-amber-400/50 bg-amber-400/10 text-amber-300"
              : "border-white/10 text-white/40"
          }`}
        >
          <IdleIcon idle={anyIdle} />
          {anyIdle ? "閒置" : "活動中"}
        </button>
      </div>

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

      {mergeCandidates && (
        <MergeConflictDialog
          candidates={mergeCandidates}
          onKeep={(instanceId) => {
            resolveMerge(instanceId);
            setMergeCandidates(null);
          }}
          onCancel={() => setMergeCandidates(null)}
        />
      )}
    </div>
  );
}
