import { usePanelUiStore } from "../panels/panelUiStore";

interface MaximizeButtonProps {
  cellId: string;
  /** Extra classes so callers can match their chrome's button styling. */
  className?: string;
}

/**
 * Toggle a cell between maximized (fills the grid) and normal. Shared by the
 * populated-panel chrome, the empty-cell chrome, and the web panel's own bar.
 */
export function MaximizeButton({ cellId, className = "" }: MaximizeButtonProps) {
  const maximizedCellId = usePanelUiStore((s) => s.maximizedCellId);
  const toggleMaximize = usePanelUiStore((s) => s.toggleMaximize);
  const isMaximized = maximizedCellId === cellId;

  return (
    <button
      type="button"
      aria-label={isMaximized ? "Restore panel" : "Maximize panel"}
      title={isMaximized ? "Restore (Esc)" : "Maximize"}
      onClick={(e) => {
        e.stopPropagation();
        toggleMaximize(cellId);
      }}
      className={className}
    >
      {isMaximized ? "⧉" : "⛶"}
    </button>
  );
}
