import {
  selectionMergeable,
  selectionSplittable,
  useLayoutStore,
} from "../store/layoutStore";
import { PRESET_COUNTS } from "../grid/presets";

/**
 * Top toolbar: pick a preset grid, and merge/split the current selection.
 * Selection is driven by clicking cells in the grid below.
 */
export function Toolbar() {
  const applyPreset = useLayoutStore((s) => s.applyPreset);
  const mergeSelected = useLayoutStore((s) => s.mergeSelected);
  const splitSelected = useLayoutStore((s) => s.splitSelected);
  const clearSelection = useLayoutStore((s) => s.clearSelection);
  const selectedCount = useLayoutStore((s) => s.selectedIds.length);
  const canMerge = useLayoutStore(selectionMergeable);
  const canSplit = useLayoutStore(selectionSplittable);

  return (
    <div className="flex items-center gap-3 border-b border-white/10 px-4 py-2">
      <span className="text-xs font-medium text-white/40">Layout</span>
      <div className="flex gap-1">
        {PRESET_COUNTS.map((count) => (
          <button
            key={count}
            onClick={() => applyPreset(count)}
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
    </div>
  );
}
