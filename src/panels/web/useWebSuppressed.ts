import { usePanelUiStore } from "../panelUiStore";
import { useLayoutStore } from "../../store/layoutStore";

interface SuppressionFlags {
  modalOpen: boolean;
  dropMenuOpen: boolean;
  workspaceMenuOpen: boolean;
  selectMode: boolean;
  maximizedCellId: string | null;
  myCellId: string | undefined;
}

/** Pure suppression decision for one web panel. Hidden by any screen-level
 *  overlay/select-mode, OR when another cell is maximized (this one is covered).
 *  Visible when it is itself the maximized cell. */
export function isWebSuppressed(f: SuppressionFlags): boolean {
  const hiddenByMaximize =
    f.maximizedCellId !== null && f.maximizedCellId !== f.myCellId;
  return (
    f.modalOpen ||
    f.dropMenuOpen ||
    f.workspaceMenuOpen ||
    f.selectMode ||
    hiddenByMaximize
  );
}

/**
 * Whether this web panel's native webview should be hidden right now. Native
 * webviews float above the DOM, so any screen-level overlay (config modal,
 * folder-drop menu, workspace dropdown), select-mode, or a maximize of a
 * different cell must hide it.
 */
export function useWebSuppressed(instanceId: string): boolean {
  const modal = usePanelUiStore((s) => s.modal);
  const dropMenu = usePanelUiStore((s) => s.dropMenu);
  const workspaceMenuOpen = usePanelUiStore((s) => s.workspaceMenuOpen);
  const maximizedCellId = usePanelUiStore((s) => s.maximizedCellId);
  const selectMode = useLayoutStore((s) => s.selectMode);
  const myCellId = useLayoutStore(
    (s) => s.layout.cells.find((c) => c.panel?.instanceId === instanceId)?.id,
  );
  return isWebSuppressed({
    modalOpen: modal !== null,
    dropMenuOpen: dropMenu !== null,
    workspaceMenuOpen,
    selectMode,
    maximizedCellId,
    myCellId,
  });
}
