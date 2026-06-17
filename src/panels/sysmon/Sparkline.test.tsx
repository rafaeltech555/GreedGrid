import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Sparkline } from "./Sparkline";

describe("Sparkline", () => {
  it("renders no polyline for empty data", () => {
    const { container } = render(<Sparkline data={[]} max={100} />);
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("polyline")).toBeNull();
  });

  it("maps values against max (value==max → top, 0 → bottom)", () => {
    const { container } = render(<Sparkline data={[0, 50, 100]} max={100} />);
    const pts = container.querySelector("polyline")!.getAttribute("points")!;
    expect(pts).toContain("0.00,100.00"); // first: value 0 → y bottom
    expect(pts).toContain("100.00,0.00"); // last: value==max → y top
  });

  it("draws a flat 2-point line for a single sample", () => {
    const { container } = render(<Sparkline data={[42]} max={100} />);
    const pts = container.querySelector("polyline")!.getAttribute("points")!;
    const coords = pts.trim().split(" ");
    expect(coords).toHaveLength(2);
    expect(coords[0].split(",")[1]).toBe(coords[1].split(",")[1]); // same y
  });
});
