import { describe, expect, it } from "vitest";
import { resizeTrack } from "./resize";

describe("resizeTrack", () => {
  it("moves fr from the right neighbour to the left one", () => {
    expect(resizeTrack([1, 1, 1], 0, 0.5)).toEqual([1.5, 0.5, 1]);
  });

  it("preserves the total fr sum", () => {
    const out = resizeTrack([2, 1, 3], 1, 0.4);
    expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(6);
  });

  it("clamps so the right track never shrinks below the min ratio", () => {
    // total 3, min ratio 0.1 -> min 0.3; right track can give at most 1 - 0.3
    const out = resizeTrack([1, 1, 1], 0, 5);
    expect(out[1]).toBeCloseTo(0.3);
    expect(out[0]).toBeCloseTo(1.7);
  });

  it("clamps so the left track never shrinks below the min ratio", () => {
    const out = resizeTrack([1, 1, 1], 0, -5);
    expect(out[0]).toBeCloseTo(0.3);
    expect(out[1]).toBeCloseTo(1.7);
  });

  it("ignores an out-of-range boundary", () => {
    const tracks = [1, 1];
    expect(resizeTrack(tracks, 1, 0.2)).toBe(tracks);
    expect(resizeTrack(tracks, -1, 0.2)).toBe(tracks);
  });
});
