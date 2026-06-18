/**
 * dropHitTest.ts
 *
 * Pure functions for converting OS drag-drop coordinates to grid cells.
 * Using plain `{id, rect}` data structures (not DOM nodes) keeps these
 * functions unit-testable without a browser environment. All coordinates
 * are in CSS pixels / viewport space so they align with values returned
 * by `getBoundingClientRect()`.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A rectangle associated with a cell id.
 * Mirrors the four values of `DOMRect` / `getBoundingClientRect()` but as a
 * plain object so tests can construct it without a DOM.
 */
export interface CellRect {
  id: string;
  rect: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
}

// ---------------------------------------------------------------------------
// physicalToCss
// ---------------------------------------------------------------------------

/**
 * Convert a physical-pixel position (as reported by Tauri v2 drag-drop
 * events) to CSS pixels.
 *
 * Why divide by dpr?
 * On HiDPI / Retina screens `devicePixelRatio` is typically 2 (or 1.5 on
 * some fractional-scaling setups).  Tauri v2 exposes the raw OS cursor
 * position in *physical* pixels, while the browser layout engine and
 * `getBoundingClientRect()` work in *CSS* pixels.  Skipping this conversion
 * shifts every hit-test by a factor of `dpr`, making drops land in the wrong
 * cell on any non-1× display.
 */
export function physicalToCss(
  pos: { x: number; y: number },
  dpr: number,
): { x: number; y: number } {
  return { x: pos.x / dpr, y: pos.y / dpr };
}

// ---------------------------------------------------------------------------
// hitTestCell
// ---------------------------------------------------------------------------

/**
 * Return the `id` of the first `CellRect` in `rects` whose boundaries
 * contain the CSS-pixel point `(cssX, cssY)`, or `null` if no rect matches.
 *
 * Boundary semantics (matches CSS box model conventions):
 *   - left  / top   edges are **inclusive** (`>=`)
 *   - right / bottom edges are **exclusive** (`<`)
 *
 * This means two adjacent, non-overlapping rects share their edge cleanly:
 * a point exactly on the shared boundary belongs to the rect whose `left`
 * (or `top`) equals that coordinate, not the one whose `right` (or `bottom`)
 * equals it.
 *
 * Design note: accepts plain `CellRect[]` rather than DOM nodes so the
 * function is pure and trivially unit-testable. The caller collects rects
 * via `element.getBoundingClientRect()` and passes the four numbers here.
 */
export function hitTestCell(
  cssX: number,
  cssY: number,
  rects: CellRect[],
): string | null {
  for (const { id, rect } of rects) {
    if (
      cssX >= rect.left &&
      cssX < rect.right &&
      cssY >= rect.top &&
      cssY < rect.bottom
    ) {
      return id;
    }
  }
  return null;
}
