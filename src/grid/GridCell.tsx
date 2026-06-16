import type { Cell, PanelKind } from "../lib/types";
import { useLayoutStore } from "../store/layoutStore";
import { getPanelType } from "../panels/registry";
import { usePanelUiStore } from "../panels/panelUiStore";
import { PanelPicker } from "../panels/PanelPicker";
import { PANEL_KIND_DND, resolveDropTarget } from "../panels/dnd";

interface GridCellProps {
  cell: Cell;
}

/**
 * One placed grid cell. Hosts a panel View when populated (with gear/✕ controls
 * on hover); otherwise shows a `+` that opens the type picker. Accepts palette
 * drops to place a panel.
 */
export function GridCell({ cell }: GridCellProps) {
  const setPanel = useLayoutStore((s) => s.setPanel);
  const clearPanel = useLayoutStore((s) => s.clearPanel);
  const cells = useLayoutStore((s) => s.layout.cells);
  const pickerCellId = usePanelUiStore((s) => s.pickerCellId);
  const openPicker = usePanelUiStore((s) => s.openPicker);
  const closePicker = usePanelUiStore((s) => s.closePicker);
  const openCreateModal = usePanelUiStore((s) => s.openCreateModal);
  const openEditModal = usePanelUiStore((s) => s.openEditModal);

  const placeKind = (kind: PanelKind) => {
    const def = getPanelType(kind);
    if (!def) return;
    closePicker();
    if (def.ready(def.defaultConfig())) {
      setPanel(cell.id, kind);
    } else {
      openCreateModal(cell.id, kind);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const kind = e.dataTransfer.getData(PANEL_KIND_DND) as PanelKind;
    if (!kind) return;
    const target = resolveDropTarget(cells, cell.id);
    if (target) placeKind(kind);
  };

  const panelDef = cell.panel ? getPanelType(cell.panel.kind) : undefined;

  return (
    <div
      style={{
        gridColumn: `${cell.col} / span ${cell.colSpan}`,
        gridRow: `${cell.row} / span ${cell.rowSpan}`,
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      className="group relative overflow-hidden rounded-md border border-white/10 bg-white/[0.03]"
      data-testid={`cell-${cell.id}`}
    >
      {cell.panel && panelDef ? (
        <>
          <panelDef.View instanceId={cell.panel.instanceId} config={cell.panel.config} />
          <div className="absolute right-1 top-1 hidden gap-1 group-hover:flex">
            <button
              aria-label="Panel settings"
              onClick={() => openEditModal(cell.id, cell.panel!.kind)}
              className="rounded bg-black/50 px-1.5 py-0.5 text-xs text-white/80 hover:text-white"
            >
              ⚙
            </button>
            <button
              aria-label="Remove panel"
              onClick={() => clearPanel(cell.id)}
              className="rounded bg-black/50 px-1.5 py-0.5 text-xs text-white/80 hover:text-white"
            >
              ✕
            </button>
          </div>
        </>
      ) : pickerCellId === cell.id ? (
        <PanelPicker onPick={placeKind} />
      ) : (
        <button
          onClick={() => openPicker(cell.id)}
          className="flex h-full w-full items-center justify-center text-2xl text-white/20 hover:text-emerald-300"
        >
          +
        </button>
      )}
    </div>
  );
}
