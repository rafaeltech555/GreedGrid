import { useRef } from "react";
import { useLayoutStore } from "../store/layoutStore";
import { resizeTrack } from "./resize";
import { useElementSize } from "./useElementSize";
import { GridCell } from "./GridCell";
import { Splitter } from "./Splitter";
import { boundarySegments } from "./merge";
import { trackSpanPx } from "./trackPx";

const SPLITTER_HIT = 10; // px hit area for grabbing a gutter

/** Cumulative pixel center of each internal boundary between `tracks`. */
function boundaryCenters(tracks: number[], areaPx: number, gap: number): number[] {
  const sum = tracks.reduce((a, b) => a + b, 0) || 1;
  const centers: number[] = [];
  let acc = 0;
  for (let i = 0; i < tracks.length - 1; i++) {
    acc += (tracks[i] / sum) * areaPx;
    // i internal gaps consumed so far, plus we sit in the middle of the next gap
    centers.push(acc + i * gap + gap / 2);
  }
  return centers;
}

/**
 * The grid surface: renders cells via CSS Grid (fr tracks + span placement) and
 * overlays draggable splitters on every internal boundary. Splitter drags
 * rewrite the `fr` arrays through the pure `resizeTrack` helper.
 */
export function GridHost() {
  const layout = useLayoutStore((s) => s.layout);
  const setCols = useLayoutStore((s) => s.setCols);
  const setRows = useLayoutStore((s) => s.setRows);

  const [ref, size] = useElementSize<HTMLDivElement>();
  // Snapshot of the track array at drag start, so each move resizes from origin.
  const dragStart = useRef<number[] | null>(null);

  const { cols, rows, gap } = layout.grid;

  const areaW = Math.max(0, size.width - (cols.length - 1) * gap);
  const areaH = Math.max(0, size.height - (rows.length - 1) * gap);
  const colCenters = boundaryCenters(cols, areaW, gap);
  const rowCenters = boundaryCenters(rows, areaH, gap);

  return (
    <div ref={ref} className="relative h-full w-full">
      <div
        className="grid h-full w-full"
        style={{
          gridTemplateColumns: cols.map((f) => `${f}fr`).join(" "),
          gridTemplateRows: rows.map((f) => `${f}fr`).join(" "),
          gap,
        }}
      >
        {layout.cells.map((cell) => (
          <GridCell key={cell.id} cell={cell} />
        ))}
      </div>

      {/* Column splitters — boundary i sits between track i and i+1; render one
          Splitter per run of rows not crossed by a merged cell. */}
      {colCenters.flatMap((pos, i) =>
        boundarySegments(layout.cells, "col", i + 1, rows.length).map((seg) => {
          const { offset, length } = trackSpanPx(rows, areaH, gap, seg.start, seg.end);
          return (
            <Splitter
              key={`col-${i}-${seg.start}`}
              orientation="col"
              pos={pos}
              hit={SPLITTER_HIT}
              crossStart={offset}
              crossLength={length}
              onDragStart={() => (dragStart.current = cols.slice())}
              onResize={(dx) => {
                if (!dragStart.current || areaW <= 0) return;
                const sum = dragStart.current.reduce((a, b) => a + b, 0);
                const dFr = (dx / areaW) * sum;
                setCols(resizeTrack(dragStart.current, i, dFr));
              }}
              onDragEnd={() => (dragStart.current = null)}
            />
          );
        }),
      )}

      {/* Row splitters. */}
      {rowCenters.flatMap((pos, i) =>
        boundarySegments(layout.cells, "row", i + 1, cols.length).map((seg) => {
          const { offset, length } = trackSpanPx(cols, areaW, gap, seg.start, seg.end);
          return (
            <Splitter
              key={`row-${i}-${seg.start}`}
              orientation="row"
              pos={pos}
              hit={SPLITTER_HIT}
              crossStart={offset}
              crossLength={length}
              onDragStart={() => (dragStart.current = rows.slice())}
              onResize={(dy) => {
                if (!dragStart.current || areaH <= 0) return;
                const sum = dragStart.current.reduce((a, b) => a + b, 0);
                const dFr = (dy / areaH) * sum;
                setRows(resizeTrack(dragStart.current, i, dFr));
              }}
              onDragEnd={() => (dragStart.current = null)}
            />
          );
        }),
      )}
    </div>
  );
}
