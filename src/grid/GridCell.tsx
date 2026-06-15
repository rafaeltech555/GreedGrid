import type { Cell } from "../lib/types";

interface GridCellProps {
  cell: Cell;
  selected: boolean;
  onToggleSelect: (id: string) => void;
}

/**
 * One placed grid cell. In M1 cells are empty drop targets; the panel host and
 * real panel content arrive in M2. Clicking toggles selection for merge/split.
 */
export function GridCell({ cell, selected, onToggleSelect }: GridCellProps) {
  return (
    <div
      onClick={() => onToggleSelect(cell.id)}
      style={{
        gridColumn: `${cell.col} / span ${cell.colSpan}`,
        gridRow: `${cell.row} / span ${cell.rowSpan}`,
      }}
      className={`flex cursor-pointer select-none items-center justify-center rounded-md border text-xs transition-colors ${
        selected
          ? "border-emerald-400/70 bg-emerald-400/10 text-emerald-200"
          : "border-white/10 bg-white/[0.03] text-white/30 hover:border-white/20"
      }`}
      data-testid={`cell-${cell.id}`}
    >
      <span className="pointer-events-none">
        {cell.panel ? cell.panel.kind : "empty"}
      </span>
    </div>
  );
}
