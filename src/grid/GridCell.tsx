import { useEffect, useState } from "react";
import type { Cell, PanelKind } from "../lib/types";
import type { SessionInfo } from "../panels/terminal/types";
import { useLayoutStore } from "../store/layoutStore";
import { getPanelType } from "../panels/registry";
import { usePanelUiStore } from "../panels/panelUiStore";
import { PanelPicker } from "../panels/PanelPicker";
import { PANEL_KIND_DND, PANEL_MOVE_DND, resolveDropTarget, resolveMove } from "../panels/dnd";
import { isTauri, pickFolder, termClose, termList } from "../lib/ipc";

interface GridCellProps {
  cell: Cell;
}

/**
 * One placed grid cell. Hosts a panel View when populated (with gear/✕ controls
 * on hover); otherwise shows a `+` that opens the type picker. Accepts palette
 * drops to place a panel.
 */
export function GridCell({ cell }: GridCellProps) {
  const [dragging, setDragging] = useState(false);
  const setPanel = useLayoutStore((s) => s.setPanel);
  const clearPanel = useLayoutStore((s) => s.clearPanel);
  const movePanel = useLayoutStore((s) => s.movePanel);
  const cells = useLayoutStore((s) => s.layout.cells);
  const toggleSelect = useLayoutStore((s) => s.toggleSelect);
  const selectedIds = useLayoutStore((s) => s.selectedIds);
  const selectMode = useLayoutStore((s) => s.selectMode);
  const pickerCellId = usePanelUiStore((s) => s.pickerCellId);
  const openPicker = usePanelUiStore((s) => s.openPicker);
  const closePicker = usePanelUiStore((s) => s.closePicker);
  const openCreateModal = usePanelUiStore((s) => s.openCreateModal);
  const openEditModal = usePanelUiStore((s) => s.openEditModal);

  const isSelected = selectedIds.includes(cell.id);
  const pickerOpen = pickerCellId === cell.id;

  // Detached pty sessions offered for reattach while this cell's picker is open.
  const [orphans, setOrphans] = useState<SessionInfo[]>([]);

  // Orphans = sessions that are detached (not attached) and not currently placed
  // in the layout — including exited sessions, which keep their scrollback so the
  // user can reattach to view final output or kill them. The `alive` flag only
  // drives PanelPicker's visual dot, not visibility.
  const computeOrphans = (sessions: SessionInfo[]): SessionInfo[] => {
    const placed = new Set<string>();
    for (const c of cells) {
      if (c.panel) placed.add(c.panel.instanceId);
    }
    return sessions.filter((s) => !s.attached && !placed.has(s.instanceId));
  };

  useEffect(() => {
    if (!pickerOpen || !isTauri()) {
      setOrphans([]);
      return;
    }
    let cancelled = false;
    termList()
      .then((sessions) => {
        if (!cancelled) setOrphans(computeOrphans(sessions));
      })
      .catch((err) => {
        console.error("term_list failed", err);
        if (!cancelled) setOrphans([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickerOpen, cells]);

  const onReattach = (info: SessionInfo) => {
    closePicker();
    setPanel(
      cell.id,
      "terminal",
      { shell: info.shell, cwd: info.cwd ?? undefined },
      () => info.instanceId,
    );
  };

  const onKill = (instanceId: string) => {
    void termClose(instanceId).catch((err) => console.error("term_close failed", err));
    setOrphans((prev) => prev.filter((o) => o.instanceId !== instanceId));
  };

  const placeKind = async (kind: PanelKind) => {
    const def = getPanelType(kind);
    if (!def) return;
    closePicker();
    if (kind === "file" || kind === "terminal") {
      const dir = await pickFolder();
      if (kind === "file") {
        setPanel(cell.id, "file", dir ? { path: dir } : undefined);
      } else {
        setPanel(cell.id, "terminal", dir ? { cwd: dir } : undefined);
      }
      return;
    }
    if (def.ready(def.defaultConfig())) {
      setPanel(cell.id, kind);
    } else {
      openCreateModal(cell.id, kind);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const fromId = e.dataTransfer.getData(PANEL_MOVE_DND);
    if (fromId) {
      if (resolveMove(cells, fromId, cell.id)) movePanel(fromId, cell.id);
      return;
    }
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
      // Capture phase so Ctrl/Cmd+click selects the cell before any inner button
      // (e.g. the empty-cell "+") fires its own onClick.
      onClickCapture={(e) => {
        if (e.ctrlKey || e.metaKey) {
          e.stopPropagation();
          e.preventDefault();
          toggleSelect(cell.id);
        }
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      className={`group relative overflow-hidden rounded-md border bg-white/[0.03] ${
        isSelected
          ? "border-emerald-400 ring-2 ring-inset ring-emerald-400"
          : selectMode
            ? "border-white/10 ring-1 ring-inset ring-white/20"
            : "border-white/10"
      }`}
      data-testid={`cell-${cell.id}`}
      data-grid-cell-id={cell.id}
    >
      {cell.panel && panelDef ? (
        <>
          <panelDef.View instanceId={cell.panel.instanceId} config={cell.panel.config} />
          {!panelDef.selfChrome && (
            <div className={`absolute right-1 top-1 gap-1 group-hover:flex group-focus-within:flex ${dragging ? "flex" : "hidden"}`}>
              <button
                type="button"
                aria-label="Move panel"
                title="Drag to move this panel"
                draggable
                onDragStart={(e) => {
                  setDragging(true);
                  e.dataTransfer.setData(PANEL_MOVE_DND, cell.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => setDragging(false)}
                className="cursor-grab rounded bg-black/50 px-1.5 py-0.5 text-xs text-white/80 hover:text-white active:cursor-grabbing"
              >
                ⠿
              </button>
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
          )}
        </>
      ) : pickerOpen ? (
        <PanelPicker
          onPick={placeKind}
          orphans={orphans}
          onReattach={onReattach}
          onKill={onKill}
        />
      ) : (
        <button
          onClick={() => openPicker(cell.id)}
          className="flex h-full w-full items-center justify-center text-2xl text-white/20 hover:text-emerald-300"
        >
          +
        </button>
      )}
      {selectMode && (
        <button
          aria-label="Select cell"
          onClick={(e) => {
            e.stopPropagation();
            toggleSelect(cell.id);
          }}
          className="absolute inset-0 z-20 cursor-pointer"
        />
      )}
    </div>
  );
}
