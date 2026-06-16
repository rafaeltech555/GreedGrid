import type { PanelKind } from "../lib/types";
import { allPanelTypes } from "./registry";

interface PanelPickerProps {
  onPick: (kind: PanelKind) => void;
}

/** A compact list of every registered panel type for an empty cell. */
export function PanelPicker({ onPick }: PanelPickerProps) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-1 p-2">
      {allPanelTypes().map((def) => (
        <button
          key={def.kind}
          onClick={() => onPick(def.kind)}
          className="flex items-center gap-1 rounded border border-white/10 px-2 py-1 text-xs text-white/70 hover:border-emerald-400/50 hover:text-white"
        >
          <span aria-hidden>{def.glyph}</span>
          {def.label}
        </button>
      ))}
    </div>
  );
}
