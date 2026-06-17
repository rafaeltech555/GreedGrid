import { useRef } from "react";

interface SplitterProps {
  orientation: "col" | "row";
  /** Center position of the gutter, in px from the container's top-left. */
  pos: number;
  /** Hit-area thickness in px (a bit wider than the visual gap for easy grabbing). */
  hit: number;
  /** Cross-axis 起始 px(col→top;row→left)。 */
  crossStart: number;
  /** Cross-axis 長度 px(col→height;row→width)。 */
  crossLength: number;
  onDragStart: () => void;
  /** Called on every move with the signed px distance from the drag origin. */
  onResize: (deltaPx: number) => void;
  onDragEnd: () => void;
}

/**
 * A draggable gutter handle overlaid on an internal track boundary. It reports
 * the pointer delta from where the drag began; GridHost converts that to `fr`.
 */
export function Splitter({
  orientation,
  pos,
  hit,
  crossStart,
  crossLength,
  onDragStart,
  onResize,
  onDragEnd,
}: SplitterProps) {
  const origin = useRef(0);
  const isCol = orientation === "col";

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    origin.current = isCol ? e.clientX : e.clientY;
    onDragStart();
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const current = isCol ? e.clientX : e.clientY;
    onResize(current - origin.current);
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    onDragEnd();
  }

  const style: React.CSSProperties = isCol
    ? { left: pos - hit / 2, top: crossStart, width: hit, height: crossLength }
    : { top: pos - hit / 2, left: crossStart, height: hit, width: crossLength };

  return (
    <div
      role="separator"
      aria-orientation={isCol ? "vertical" : "horizontal"}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      className={`group absolute z-10 flex items-center justify-center ${
        isCol ? "cursor-col-resize" : "cursor-row-resize"
      }`}
      style={style}
    >
      {/* thin visible line, brightens on hover */}
      <div
        className={`bg-white/10 transition-colors group-hover:bg-emerald-400/60 ${
          isCol ? "h-full w-px" : "h-px w-full"
        }`}
      />
    </div>
  );
}
