import { usePanelUiStore } from "../panelUiStore";
import { useLayoutStore } from "../../store/layoutStore";

/**
 * Whether all web panels' native webviews should be hidden right now. Native
 * webviews float above the DOM, so any screen-level overlay (config modal, the
 * folder-drop menu, the workspace dropdown) or select-mode must hide them so the
 * overlay/selection UI underneath stays usable.
 */
export function useWebSuppressed(): boolean {
  const modal = usePanelUiStore((s) => s.modal);
  const dropMenu = usePanelUiStore((s) => s.dropMenu);
  const workspaceMenuOpen = usePanelUiStore((s) => s.workspaceMenuOpen);
  const selectMode = useLayoutStore((s) => s.selectMode);
  return modal !== null || dropMenu !== null || workspaceMenuOpen || selectMode;
}
