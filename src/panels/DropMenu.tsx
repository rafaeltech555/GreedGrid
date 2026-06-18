import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePanelUiStore } from "./panelUiStore";
import { useLayoutStore } from "../store/layoutStore";
import type { PanelKind } from "../lib/types";

/** Clamps a floating element's position so it stays within the viewport with `margin` padding. */
export function clampToViewport(
  x: number,
  y: number,
  w: number,
  h: number,
  vw: number,
  vh: number,
  margin = 8,
): { left: number; top: number } {
  return {
    left: Math.min(x, vw - w - margin),
    top: Math.min(y, vh - h - margin),
  };
}

/**
 * Floating menu shown after an OS folder is dropped onto a grid cell.
 * The user picks File or Terminal; if the target cell is already occupied
 * a confirmation step is shown first.
 */
export function DropMenu() {
  const dropMenu = usePanelUiStore((s) => s.dropMenu);
  const closeDropMenu = usePanelUiStore((s) => s.closeDropMenu);
  const setPanel = useLayoutStore((s) => s.setPanel);

  // When the target cell is occupied, we hold the pending choice here before
  // showing the overwrite confirm UI.
  const [pending, setPending] = useState<{
    kind: PanelKind;
    config: Record<string, unknown>;
  } | null>(null);

  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });

  useEffect(() => {
    if (!dropMenu) return;
    setPending(null);            // new drop arrived: clear stale confirm state
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setPending(null); closeDropMenu(); }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [dropMenu, closeDropMenu]);

  useLayoutEffect(() => {
    if (!dropMenu) return;
    // Start at raw drop coordinates
    setPos({ left: dropMenu.x, top: dropMenu.y });
  }, [dropMenu]);

  useLayoutEffect(() => {
    if (!dropMenu || !menuRef.current) return;
    const { width, height } = menuRef.current.getBoundingClientRect();
    if (width === 0 && height === 0) return; // jsdom / not yet painted
    const clamped = clampToViewport(dropMenu.x, dropMenu.y, width, height, window.innerWidth, window.innerHeight);
    setPos(clamped);
  }, [dropMenu]);

  if (dropMenu == null) return null;

  const { cellId, path } = dropMenu;

  function choose(kind: PanelKind) {
    const config: Record<string, unknown> =
      kind === "file" ? { path } : { cwd: path };

    const existingPanel = useLayoutStore
      .getState()
      .layout.cells.find((c) => c.id === cellId)?.panel;

    if (existingPanel) {
      // Cell is occupied — ask for confirmation before overwriting.
      setPending({ kind, config });
    } else {
      setPanel(cellId, kind, config);
      closeDropMenu();
    }
  }

  function confirmOverwrite() {
    if (!pending) return;
    setPanel(cellId, pending.kind, pending.config);
    setPending(null);
    closeDropMenu();
  }

  function cancelOverwrite() {
    setPending(null);
    closeDropMenu();
  }

  // Truncate long paths for display (keep first + last segment).
  const displayPath =
    path.length > 48
      ? `…${path.slice(path.length - 45)}`
      : path;

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Open folder as"
      style={{ position: "fixed", left: pos.left, top: pos.top, zIndex: 9999 }}
      className="min-w-[160px] rounded border border-white/10 bg-neutral-900 p-2 shadow-lg"
    >
      {pending == null ? (
        <>
          <p
            className="mb-2 truncate px-1 text-[10px] text-white/40"
            title={path}
          >
            {displayPath}
          </p>
          <button
            role="menuitem"
            aria-label="Open as File Browser"
            onClick={() => choose("file")}
            className="flex w-full items-center gap-2 rounded px-2 py-1 text-sm text-white/80 hover:bg-emerald-500/20 hover:text-white"
          >
            <span aria-hidden>📁</span> File
          </button>
          <button
            role="menuitem"
            aria-label="Open as Terminal"
            onClick={() => choose("terminal")}
            className="flex w-full items-center gap-2 rounded px-2 py-1 text-sm text-white/80 hover:bg-emerald-500/20 hover:text-white"
          >
            <span aria-hidden>⌨</span> Terminal
          </button>
        </>
      ) : (
        <>
          <p className="mb-2 px-1 text-xs text-amber-400">
            ⚠ 覆蓋現有 panel?
          </p>
          <div className="flex gap-1">
            <button
              role="menuitem"
              aria-label="Cancel overwrite"
              onClick={cancelOverwrite}
              className="flex-1 rounded border border-white/10 px-2 py-1 text-xs text-white/60 hover:border-white/20 hover:text-white"
            >
              取消
            </button>
            <button
              role="menuitem"
              aria-label="Confirm overwrite"
              onClick={confirmOverwrite}
              className="flex-1 rounded bg-emerald-600/70 px-2 py-1 text-xs text-white hover:bg-emerald-500"
            >
              覆蓋
            </button>
          </div>
        </>
      )}
    </div>
  );
}
