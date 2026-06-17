import type { ReactNode } from "react";

interface SparklineProps {
  data: number[];
  max: number;
  className?: string;
}

/** Minimal SVG sparkline: `data` → a polyline in a 0..100 viewBox, higher value
 *  = higher line. Stroke is `currentColor` so the parent picks the colour via a
 *  Tailwind text class. Empty data renders an empty svg; a single sample renders
 *  a flat line; `max <= 0` is treated as 1 to avoid divide-by-zero. */
export function Sparkline({ data, max, className }: SparklineProps): ReactNode {
  const cap = max > 0 ? max : 1;
  const n = data.length;
  const coords: Array<[number, number]> = data.map((v, i) => {
    const x = n === 1 ? 0 : (i / (n - 1)) * 100;
    const y = 100 - Math.min(Math.max(v / cap, 0), 1) * 100;
    return [x, y];
  });
  if (n === 1) coords.push([100, coords[0][1]]); // flat line for one sample
  const points = coords.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className={className}
      data-testid="sparkline"
    >
      {n > 0 && (
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}
