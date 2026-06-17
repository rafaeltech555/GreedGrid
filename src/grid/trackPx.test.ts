import { describe, expect, it } from "vitest";
import { trackSpanPx } from "./trackPx";

describe("trackSpanPx", () => {
  it("single first track: offset 0, width = its share", () => {
    expect(trackSpanPx([1, 1], 100, 10, 1, 1)).toEqual({ offset: 0, length: 50 });
  });

  it("spanning both tracks includes the internal gap", () => {
    expect(trackSpanPx([1, 1], 100, 10, 1, 2)).toEqual({ offset: 0, length: 110 });
  });

  it("second track: offset past first track + one gap", () => {
    expect(trackSpanPx([1, 1], 100, 10, 2, 2)).toEqual({ offset: 60, length: 50 });
  });

  it("uneven fr ratios split area proportionally", () => {
    expect(trackSpanPx([1, 3], 100, 10, 2, 2)).toEqual({ offset: 35, length: 75 });
  });
});
