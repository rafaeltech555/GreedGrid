import { describe, expect, it } from "vitest";
import { hitTestCell, physicalToCss } from "./dropHitTest";
import type { CellRect } from "./dropHitTest";

// ---------------------------------------------------------------------------
// physicalToCss
// ---------------------------------------------------------------------------

describe("physicalToCss", () => {
  it("dpr=2: halves both coordinates", () => {
    expect(physicalToCss({ x: 200, y: 100 }, 2)).toEqual({ x: 100, y: 50 });
  });

  it("dpr=1: returns the same values", () => {
    expect(physicalToCss({ x: 300, y: 150 }, 1)).toEqual({ x: 300, y: 150 });
  });

  it("dpr=1.5 (non-integer): divides correctly", () => {
    // 300 / 1.5 = 200, 90 / 1.5 = 60
    expect(physicalToCss({ x: 300, y: 90 }, 1.5)).toEqual({ x: 200, y: 60 });
  });
});

// ---------------------------------------------------------------------------
// hitTestCell
// ---------------------------------------------------------------------------

// Helper to build a CellRect easily.
function rect(
  id: string,
  left: number,
  top: number,
  right: number,
  bottom: number,
): CellRect {
  return { id, rect: { left, top, right, bottom } };
}

describe("hitTestCell", () => {
  const rects: CellRect[] = [
    rect("a", 0, 0, 100, 100),
    rect("b", 100, 0, 200, 100),
    rect("c", 0, 100, 100, 200),
  ];

  it("hit: coordinate inside a rect returns its id", () => {
    expect(hitTestCell(50, 50, rects)).toBe("a");
    expect(hitTestCell(150, 50, rects)).toBe("b");
    expect(hitTestCell(50, 150, rects)).toBe("c");
  });

  it("miss: coordinate outside all rects returns null", () => {
    expect(hitTestCell(250, 50, rects)).toBeNull();
    expect(hitTestCell(50, 250, rects)).toBeNull();
  });

  it("empty rects array returns null", () => {
    expect(hitTestCell(50, 50, [])).toBeNull();
  });

  it("open-interval on right/bottom: x===rect.right is NOT a hit", () => {
    // x=100 is rect "a"'s right edge — should miss "a"
    expect(hitTestCell(100, 50, [rect("a", 0, 0, 100, 100)])).toBeNull();
  });

  it("open-interval on right/bottom: y===rect.bottom is NOT a hit", () => {
    expect(hitTestCell(50, 100, [rect("a", 0, 0, 100, 100)])).toBeNull();
  });

  it("closed-interval on left/top: x===rect.left IS a hit", () => {
    expect(hitTestCell(0, 50, [rect("a", 0, 0, 100, 100)])).toBe("a");
  });

  it("closed-interval on left/top: y===rect.top IS a hit", () => {
    expect(hitTestCell(50, 0, [rect("a", 0, 0, 100, 100)])).toBe("a");
  });

  it("boundary between two adjacent rects: point at shared edge belongs to the right/lower rect (left=edge)", () => {
    // Two horizontally adjacent rects with shared edge at x=100.
    // x=100 should NOT hit "left" (right=100, open) but SHOULD hit "right" (left=100, closed).
    const adjacent = [rect("left", 0, 0, 100, 100), rect("right", 100, 0, 200, 100)];
    expect(hitTestCell(100, 50, adjacent)).toBe("right");
  });

  it("overlapping rects: returns the first matching id in the array", () => {
    // "first" fully contains "second"; a point inside both should return "first".
    const overlapping = [rect("first", 0, 0, 200, 200), rect("second", 50, 50, 150, 150)];
    expect(hitTestCell(100, 100, overlapping)).toBe("first");
  });
});
