import { describe, expect, it } from "vitest";
import { measureRect } from "./geometry";

function fakeEl(rect: Partial<DOMRect>): HTMLElement {
  return {
    getBoundingClientRect: () =>
      ({ left: 0, top: 0, width: 0, height: 0, ...rect }) as DOMRect,
  } as HTMLElement;
}

describe("measureRect", () => {
  it("maps left/top/width/height to a rounded WebRect", () => {
    const el = fakeEl({ left: 10.4, top: 20.6, width: 300.5, height: 200.2 });
    expect(measureRect(el)).toEqual({ x: 10, y: 21, width: 301, height: 200 });
  });
});
