import { allPanelTypes } from "./registry";
import { PANEL_KIND_DND } from "./dnd";

/** Left column listing panel types; each item is an HTML5 drag source. */
export function Palette() {
  return (
    <aside className="flex w-28 shrink-0 flex-col gap-1 border-r border-white/10 p-2">
      <span className="px-1 text-xs font-medium text-white/40">Panels</span>
      {allPanelTypes().map((def) => (
        <div
          key={def.kind}
          draggable="true"
          onDragStart={(e) => e.dataTransfer.setData(PANEL_KIND_DND, def.kind)}
          className="flex cursor-grab items-center gap-1 rounded border border-white/10 px-2 py-1 text-xs text-white/70 hover:border-emerald-400/50 active:cursor-grabbing"
        >
          <span aria-hidden>{def.glyph}</span>
          {def.label}
        </div>
      ))}
    </aside>
  );
}
