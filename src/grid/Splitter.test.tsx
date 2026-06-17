import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Splitter } from "./Splitter";

const noop = () => {};

describe("Splitter cross-axis range", () => {
  it("col splitter uses crossStart/crossLength for top/height", () => {
    render(
      <Splitter
        orientation="col"
        pos={100}
        hit={10}
        crossStart={20}
        crossLength={200}
        onDragStart={noop}
        onResize={vi.fn()}
        onDragEnd={noop}
      />,
    );
    const el = screen.getByRole("separator");
    expect(el.style.top).toBe("20px");
    expect(el.style.height).toBe("200px");
    expect(el.style.left).toBe("95px");
    expect(el.style.width).toBe("10px");
  });

  it("row splitter uses crossStart/crossLength for left/width", () => {
    render(
      <Splitter
        orientation="row"
        pos={100}
        hit={10}
        crossStart={20}
        crossLength={200}
        onDragStart={noop}
        onResize={vi.fn()}
        onDragEnd={noop}
      />,
    );
    const el = screen.getByRole("separator");
    expect(el.style.left).toBe("20px");
    expect(el.style.width).toBe("200px");
    expect(el.style.top).toBe("95px");
    expect(el.style.height).toBe("10px");
  });
});
